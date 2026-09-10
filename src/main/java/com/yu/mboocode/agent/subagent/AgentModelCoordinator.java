package com.yu.mboocode.agent.subagent;

import com.yu.mboocode.agent.skill.SkillChatRequestTransformer;
import com.yu.mboocode.llm.prompt.SystemPromptService;
import com.yu.mboocode.llm.service.ChatMemoryService;
import dev.langchain4j.data.message.*;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.response.*;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import java.util.*;

/** 在真实模型请求边界冻结输入，并在同一个工具循环中纠正未收齐结果的提前答复。 */
@Component
public class AgentModelCoordinator {
    @Resource
    private com.yu.mboocode.agent.service.ModelUsageTracker usageTracker;
    @Resource
    private AgentExecutionRegistry registry;
    @Resource
    private ConversationForkService forkService;
    @Resource
    private SubagentService subagentService;
    @Resource
    private ChatMemoryService memoryService;
    @Resource
    private SystemPromptService promptService;
    @Resource
    private SkillChatRequestTransformer skillTransformer;
    @Resource
    private org.springframework.beans.factory.ObjectProvider<ChatMemoryProvider> memoryProvider;
    private final Map<ChatRequest, RequestState> requests = Collections.synchronizedMap(new IdentityHashMap<>());

    public ChatRequest transform(ChatRequest request, Object memoryId) {
        String sessionId = String.valueOf(memoryId);
        var execution = registry.require(sessionId);
        ChatRequest transformed = skillTransformer.transform(request, memoryId);
        // 单 turn 互斥保证历史在组装期间不被压缩；摘要和保留结果只读同一行并同时用于请求及快照。
        var state = memoryService.getById(sessionId);
        String summary = state == null ? null : state.getSummaryText();
        String retained = state == null ? null : state.getRetainedToolResultsJson();
        List<ChatMessage> messages = new ArrayList<>();
        String system = promptService.compose(execution.prompt, summary, retained);
        messages.add(SystemMessage.from(system));
        messages.addAll(transformed.messages().stream().filter(message -> !(message instanceof SystemMessage)).toList());
        transformed = transformed.toBuilder().messages(messages).build();
        ConversationForkService.Snapshot snapshot = null;
        if (!execution.child()) {
            try { snapshot = forkService.freeze(sessionId, execution.turn.turnId(), execution.requestSequence.incrementAndGet(), messages, summary, retained); }
            catch (SubagentException ignored) { /* 非安全历史不提供 fork 句柄，但不阻止普通对话继续。 */ }
        }
        requests.put(transformed, new RequestState(execution, snapshot));
        return transformed;
    }

    public StreamingChatModel wrap(StreamingChatModel delegate) {
        return new StreamingChatModel() {
            @Override
            public void chat(ChatRequest request, StreamingChatResponseHandler handler) {
                RequestState state = requests.remove(request);
                if (state == null) { handler.onError(new IllegalStateException("模型请求缺少执行身份")); return; }
                send(delegate, request, state, handler);
            }
        };
    }

    private void send(StreamingChatModel delegate, ChatRequest request, RequestState state, StreamingChatResponseHandler handler) {
        var execution = state.execution();
        if (execution.cancelled.get()) { handler.onError(new IllegalStateException("模型执行已取消")); return; }
        subagentService.confirmDelivery(execution.turn.sessionId(), execution.turn.turnId(), request.messages());
        java.util.concurrent.atomic.AtomicBoolean responseHandled = new java.util.concurrent.atomic.AtomicBoolean();
        delegate.chat(request, new StreamingChatResponseHandler() {
            @Override
            public void onPartialResponse(String text) { handler.onPartialResponse(text); }
            @Override
            public void onPartialResponse(PartialResponse response, PartialResponseContext context) { handler.onPartialResponse(response, context); }
            @Override
            public void onPartialThinking(PartialThinking thinking, PartialThinkingContext context) { handler.onPartialThinking(thinking, context); }
            @Override
            public void onPartialToolCall(PartialToolCall call, PartialToolCallContext context) { handler.onPartialToolCall(call, context); }
            @Override
            public void onCompleteToolCall(CompleteToolCall call) { handler.onCompleteToolCall(call); }
            @Override
            public void onCompleteResponse(ChatResponse response) {
                try {
                    if (!responseHandled.compareAndSet(false, true) || execution.cancelled.get()) return;
                    var usage = response.tokenUsage();
                    var normalizedUsage = usageTracker.normalize(execution.parameters.modelName(), usage);
                    if (normalizedUsage != null) {
                        synchronized (execution) {
                            execution.inputTokens = add(execution.inputTokens, usage.inputTokenCount());
                            execution.outputTokens = add(execution.outputTokens, usage.outputTokenCount());
                            execution.totalTokens = (execution.totalTokens == null ? 0L : execution.totalTokens) + normalizedUsage.totalTokens();
                        }
                    }
                    AiMessage message = response.aiMessage();
                    if (message.hasToolExecutionRequests()) {
                        if (execution.toolRounds.incrementAndGet() > 100) throw new SubagentException("TOOL_ROUND_LIMIT", "工具往返已达 100 轮上限");
                        if (state.snapshot() != null) forkService.bind(state.snapshot(), usageTracker.invocationId(execution.turn.sessionId()), message.toolExecutionRequests());
                    } else {
                        String instruction = subagentService.joinInstruction(execution);
                        if (instruction != null) {
                            usageTracker.onDirectResponse(execution.turn.sessionId(), execution.turn.turnId(), usage);
                            if (execution.joinCorrections.incrementAndGet() > 2) throw new SubagentException("SUBAGENT_JOIN_REQUIRED", "主模型未按要求收齐子执行结果");
                            if (execution.checkpoint != null) execution.checkpoint.run();
                            // 这里拦截了框架的 onCompleteResponse，框架尚未 addToMemory；必须保存真实提前答复一次。
                            memoryProvider.getObject().get(execution.turn.sessionId()).add(message);
                            List<ChatMessage> messages = new ArrayList<>(request.messages());
                            messages.add(message);
                            ChatRequest next = transform(request.toBuilder().messages(messages).build(), execution.turn.sessionId());
                            List<ChatMessage> corrected = new ArrayList<>(next.messages());
                            SystemMessage base = (SystemMessage) corrected.getFirst();
                            corrected.set(0, SystemMessage.from(base.text() + "\n\n<subagent-runtime-state>\n" + instruction + "\n</subagent-runtime-state>"));
                            RequestState nextState = requests.remove(next);
                            send(delegate, next.toBuilder().messages(corrected).build(), nextState, handler);
                            return;
                        }
                    }
                    handler.onCompleteResponse(response);
                } catch (Throwable error) { handler.onError(error); }
            }
            @Override
            public void onError(Throwable error) { if (responseHandled.compareAndSet(false, true)) handler.onError(error); }
        });
    }

    private Long add(Long current, Integer value) { return value == null || value < 0 ? current : (current == null ? 0L : current) + value; }
    public void release(String sessionId) { synchronized (requests) { requests.entrySet().removeIf(entry -> entry.getValue().execution().turn.sessionId().equals(sessionId)); } }
    private record RequestState(AgentExecutionRegistry.Execution execution, ConversationForkService.Snapshot snapshot) {}
}
