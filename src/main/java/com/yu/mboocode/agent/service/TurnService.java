package com.yu.mboocode.agent.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.model.payload.*;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.AiCodeService;
import com.yu.mboocode.agent.base.TurnProcess;
import com.yu.mboocode.agent.enums.SessionEventSource;
import com.yu.mboocode.agent.enums.SessionEventType;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.common.util.DateTimeUtil;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.memory.ChatMemory;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.model.chat.response.StreamingHandle;
import dev.langchain4j.service.tool.ToolExecution;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.jspecify.annotations.NonNull;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;
import reactor.core.publisher.FluxSink;

import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

@Service
@Slf4j
public class TurnService {
    @Resource
    private AiCodeService aiCodeService;
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SessionService sessionService;
    @Resource
    private ToolApprovalService toolApprovalService;
    @Resource
    private ChatMemoryProvider chatMemoryProvider;

    //todo 取消竞态处理 cas

    public Flux<@NonNull SessionEvent> turn(String sessionId, String workspacePath, TurnProcess turnProcess) {
        SessionTurn sessionTurn = SpringUtil.getBean(getClass()).startTurn(sessionId, workspacePath);
        return Flux.defer(() -> Flux.defer(() -> turnProcess.process(sessionTurn))
                .onErrorResume(error ->
                        Flux.just(sessionEventStore.appendSession(
                                sessionTurn.transcriptUri(),
                                sessionTurn.sessionId(),
                                sessionTurn.turnId(),
                                SessionEventType.ERROR,
                                SessionEventSource.SYSTEM,
                                ErrorPayload.builder()
                                        .errorMessage(StrUtil.blankToDefault(error.getMessage(), "未知错误"))
                                        .durationMs(DateTimeUtil.durationMs(sessionTurn.startNano()))
                                        .build()
                        )))
                .doOnCancel(() -> {
                    // 只是持久化取消事件，不是很重要，暂时不用 CAS 跟 doOnComplete 竞争终态
                    sessionEventStore.appendSession(
                            sessionTurn.transcriptUri(),
                            sessionTurn.sessionId(),
                            sessionTurn.turnId(),
                            SessionEventType.CANCELLED,
                            SessionEventSource.SYSTEM,
                            CancelledPayload.builder()
                                    .durationMs(DateTimeUtil.durationMs(sessionTurn.startNano()))
                                    .build()
                    );
                })
                .doFinally(_ -> {
                    try {
                        sessionService.clearActiveTurn(sessionTurn.sessionId(), sessionTurn.turnId());
                    } catch (Exception e) {
                        log.error("clearActiveTurn 失败 sessionId:{} turnId:{}", sessionTurn.sessionId(), sessionTurn.turnId(), e);
                    }
                }));
    }

    @Transactional
    public SessionTurn startTurn(String sessionId, String workspacePath) {
        Sessions session = sessionService.getActiveOrCreateSession(sessionId, workspacePath);
        String turnId = IdUtil.getSnowflakeNextIdStr();
        if (!sessionService.updateActiveTurn(session.getId(), turnId)) {
            throw new ServiceException("当前会话已有运行中的 turn");
        }

        //todo 此处应该有识别僵尸 turn 并清理逻辑

        return new SessionTurn(session.getId(), session.getTranscriptUri(), turnId, System.nanoTime());
    }

    public Flux<@NonNull SessionEvent> chatStream(SessionTurn sessionTurn, String userMessage, ChatRequestParameters params) {
        String userMessageId = IdUtil.getSnowflakeNextIdStr();
        Flux<@NonNull SessionEvent> userMessageFlux = Flux.just(sessionEventStore.appendSession(
                sessionTurn.transcriptUri(),
                sessionTurn.sessionId(),
                sessionTurn.turnId(),
                SessionEventType.USER_MESSAGE,
                SessionEventSource.USER,
                UserMessagePayload.builder()
                        .messageId(userMessageId)
                        .text(userMessage)
                        .build()
        ));

        String assistantMessageId = IdUtil.getSnowflakeNextIdStr();
        StringBuffer finalText = new StringBuffer();
        Flux<@NonNull SessionEvent> assistantMessageFlux = Flux.create(sink -> {
            AtomicReference<StreamingHandle> streamingHandleRef = new AtomicReference<>();

            // 注册流取消处理器
            sink.onCancel(() -> {
                Optional.ofNullable(streamingHandleRef.get()).ifPresent(StreamingHandle::cancel);
                toolApprovalService.cancelTurn(sessionTurn.sessionId(), sessionTurn.turnId());

                String text = finalText.toString();
                if (StrUtil.isNotBlank(text)) {
                    sessionEventStore.appendSession(sessionTurn.transcriptUri(), SessionEvent.builder()
                            .eventId(IdUtil.getSnowflakeNextIdStr())
                            .sessionId(sessionTurn.sessionId())
                            .turnId(sessionTurn.turnId())
                            .type(SessionEventType.ASSISTANT_MESSAGE)
                            .source(SessionEventSource.ASSISTANT)
                            .createdAt(DateTimeUtil.now())
                            .payload(AssistantMessagePayload.builder()
                                    .messageId(assistantMessageId)
                                    .state(AssistantMessagePayload.AssistantMessageState.CANCEL)
                                    .text(text)
                                    .durationMs(DateTimeUtil.durationMs(sessionTurn.startNano()))
                                    .build())
                            .meta(Collections.emptyMap())
                            .build());
                    appendInterruptedMemory(sessionTurn.sessionId(), text);
                }
            }); // 方法内有做处理，暂时不用 CAS 跟 onCompleteResponse 竞争终态

            aiCodeService.chatStream(sessionTurn.sessionId(), userMessage, params)
                    .onPartialResponseWithContext((response, context) -> { // 助手回复
                        if (cancelHandle(sink, context.streamingHandle(), streamingHandleRef)) {
                            return;
                        }

                        String text = response.text();
                        emitEvent(sink, () -> SessionEvent.builder()
                                .eventId(IdUtil.getSnowflakeNextIdStr())
                                .sessionId(sessionTurn.sessionId())
                                .turnId(sessionTurn.turnId())
                                .type(SessionEventType.ASSISTANT_MESSAGE_DELTA)
                                .source(SessionEventSource.ASSISTANT)
                                .createdAt(DateTimeUtil.now())
                                .payload(AssistantMessageDeltaPayload.builder().messageId(assistantMessageId).text(text).build())
                                .meta(Collections.emptyMap())
                                .build());
                        finalText.append(text);
                    })
                    .onPartialThinkingWithContext((thinking, context) -> { // 思考
                        if (cancelHandle(sink, context.streamingHandle(), streamingHandleRef)) {
                            return;
                        }

                        // todo 记录思考
                    })
                    .onPartialToolCallWithContext((toolCall, context) -> cancelHandle(sink, context.streamingHandle(), streamingHandleRef)) // tool call
                    .beforeToolExecution(beforeToolExecution -> { // 工具调用前
                        ToolExecutionRequest request = beforeToolExecution.request();
                        Runnable toolStartedEmitter = () -> emitEvent(sink, () -> sessionEventStore.appendSession(
                                        sessionTurn.transcriptUri(),
                                        sessionTurn.sessionId(),
                                        sessionTurn.turnId(),
                                        SessionEventType.TOOL_CALL_STARTED,
                                        SessionEventSource.ASSISTANT,
                                        ToolCallStartedPayload.builder()
                                                .messageId(assistantMessageId)
                                                .toolCallId(request.id())
                                                .toolName(request.name())
                                                .arguments(request.arguments())
                                                .build()
                                ));
                        boolean waitingApproval = toolApprovalService.requestIfNeeded(sessionTurn, assistantMessageId, request, sink::next, toolStartedEmitter);
                        if (!waitingApproval) {
                            toolStartedEmitter.run();
                        }
                    })
                    .onToolExecuted(toolExecution -> {
                        ToolExecutionRequest request = toolExecution.request();
                        boolean failed = toolExecution.hasFailed();
                        String resultPreview = toolResultPreview(toolExecution);
                        ToolCallEndedPayload.ToolCallStatus status = failed ? ToolCallEndedPayload.ToolCallStatus.FAILED : ToolCallEndedPayload.ToolCallStatus.COMPLETED;
                        ToolCallEndedPayload payload = ToolCallEndedPayload.builder()
                                .messageId(assistantMessageId)
                                .toolCallId(request.id())
                                .toolName(request.name())
                                .arguments(request.arguments())
                                .status(status)
                                .resultPreview(resultPreview)
                                .errorCode(failed ? "TOOL_EXECUTION_FAILED" : null)
                                .errorMessage(failed ? resultPreview : null)
                                .durationMs(toolExecution.duration().toMillis())
                                .build();

                        emitEvent(sink, () -> sessionEventStore.appendSession(
                                sessionTurn.transcriptUri(),
                                sessionTurn.sessionId(),
                                sessionTurn.turnId(),
                                SessionEventType.TOOL_CALL_ENDED,
                                SessionEventSource.SYSTEM,
                                payload
                        ));
                    })
                    .onCompleteResponse(chatResponse -> {
                        //todo chatResponse.aiMessage() 其他内容处理 机制确认
                        emitEvent(sink, () -> sessionEventStore.appendSession(sessionTurn.transcriptUri(), SessionEvent.builder()
                                .eventId(IdUtil.getSnowflakeNextIdStr())
                                .sessionId(sessionTurn.sessionId())
                                .turnId(sessionTurn.turnId())
                                .type(SessionEventType.ASSISTANT_MESSAGE)
                                .source(SessionEventSource.ASSISTANT)
                                .createdAt(DateTimeUtil.now())
                                .payload(AssistantMessagePayload.builder()
                                        .messageId(assistantMessageId)
                                        .state(AssistantMessagePayload.AssistantMessageState.COMPLETE)
                                        .text(chatResponse.aiMessage().text())
                                        .durationMs(DateTimeUtil.durationMs(sessionTurn.startNano()))
                                        .build())
                                .meta(Collections.emptyMap())
                                .build()));
                        sink.complete();
                    })
                    .onError(error -> {
                        String text = finalText.toString();
                        if (StrUtil.isNotBlank(text)) {emitEvent(sink, () -> sessionEventStore.appendSession(sessionTurn.transcriptUri(), SessionEvent.builder()
                                .eventId(IdUtil.getSnowflakeNextIdStr())
                                .sessionId(sessionTurn.sessionId())
                                .turnId(sessionTurn.turnId())
                                .type(SessionEventType.ASSISTANT_MESSAGE)
                                .source(SessionEventSource.ASSISTANT)
                                .createdAt(DateTimeUtil.now())
                                .payload(AssistantMessagePayload.builder()
                                        .messageId(assistantMessageId)
                                        .state(AssistantMessagePayload.AssistantMessageState.ERROR)
                                        .text(text)
                                        .errorMessage(error.getMessage())
                                        .durationMs(DateTimeUtil.durationMs(sessionTurn.startNano()))
                                        .build())
                                .meta(Collections.emptyMap())
                                .build()));
                            appendInterruptedMemory(sessionTurn.sessionId(), text);
                        }
                        sink.error(error);
                    })
                    .start();
        }, FluxSink.OverflowStrategy.BUFFER);
        return userMessageFlux.concatWith(assistantMessageFlux);
    }

    private boolean cancelHandle(FluxSink<@NonNull SessionEvent> sink, StreamingHandle streamingHandle, AtomicReference<StreamingHandle> streamingHandleRef) {
        streamingHandleRef.set(streamingHandle);
        if (sink.isCancelled()) {
            streamingHandle.cancel();
            return true;
        }
        return false;
    }

    private void appendInterruptedMemory(String sessionId, String text) {
        if (StrUtil.isBlank(text)) {
            return;
        }

        try {
            ChatMemory chatMemory = chatMemoryProvider.get(sessionId);
            List<ChatMessage> messages = chatMemory.messages();
            // 完整响应可能已经由 LangChain4j 先写入，最后一条是 AI 消息时不再重复追加部分响应。
            if (!messages.isEmpty() && messages.getLast() instanceof AiMessage) {
                return;
            }
            chatMemory.add(AiMessage.from(text));
        } catch (RuntimeException e) {
            // JSONL 是事实来源，派生记忆写入失败不能阻止错误或取消事件落盘。
            log.warn("写入中断会话记忆失败，sessionId: {}", sessionId, e);
        }
    }

    private void emitEvent(FluxSink<@NonNull SessionEvent> sink, Supplier<SessionEvent> s) {
        if (!sink.isCancelled()) {
            sink.next(s.get());
        }
    }

    private String toolResultPreview(ToolExecution toolExecution) {
        //todo 返回结构处理
        try {
            Object resultObject = toolExecution.resultObject();
            if (resultObject instanceof CharSequence text) {
                return truncateToolText(text.toString());
            }
            if (resultObject != null) {
                return truncateToolText(JSON.toJSONString(resultObject));
            }
        } catch (RuntimeException ignored) {
            // 部分工具只提供文本结果，继续尝试读取 result()。
        }

        try {
            return truncateToolText(toolExecution.result());
        } catch (RuntimeException e) {
            return "";
        }
    }

    private String truncateToolText(String text) {
        if (text == null) {
            return "";
        }
        int maxLength = 2000;
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "\n...（结果已截断）";
    }
}
