package com.yu.mboocode.llm.context;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.enums.SessionEventSource;
import com.yu.mboocode.agent.enums.SessionEventType;
import com.yu.mboocode.agent.model.ContextUsageSnapshot;
import com.yu.mboocode.agent.model.ModelInfo;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.payload.ContextCompressionPayload;
import com.yu.mboocode.agent.service.ModelContextPreferenceService;
import com.yu.mboocode.agent.service.ModelOptionService;
import com.yu.mboocode.agent.service.SessionEventStore;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.common.util.DateTimeUtil;
import com.yu.mboocode.llm.AiCodeService;
import com.yu.mboocode.llm.model.ChatMemory;
import com.yu.mboocode.llm.prompt.SystemPromptService;
import com.yu.mboocode.llm.prompt.SystemPromptSnapshot;
import com.yu.mboocode.llm.service.ChatMemoryService;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ChatMessageDeserializer;
import dev.langchain4j.data.message.ChatMessageSerializer;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 上下文管理编排服务。
 *
 * <p>负责 ChatMemory turn 解析、工具压薄、自动压缩触发判断、摘要原子提交、
 * pending 完成事件恢复和新消息硬预算检查。压缩事件写入 JSONL 并返回给调用方推送 SSE；
 * 摘要正文、工具输出和 diff 不进入事件、日志和前端。</p>
 */
@Service
@Slf4j
public class ContextManagementService {
    /**
     * 自动压缩触发阈值：上一轮实际 usage 占上下文窗口比例。
     */
    private static final double AUTO_TRIGGER_RATIO = 0.70;

    /**
     * 压缩后“系统提示、摘要和历史消息”的内部估算目标占窗口比例。
     */
    private static final double POST_COMPRESSION_TARGET_RATIO = 0.50;

    /**
     * 最近多少个历史 turn 保留原始工具交互。
     */
    private static final int RETAINED_RAW_TURNS = 4;

    /**
     * 正常压缩保留的历史 turn 数；预算不足时按 6、4、2、1 逐级降低。
     */
    private static final int[] RETAINED_CANDIDATES = {6, 4, 2, 1};

    private static final int NORMAL_RETAINED_TURNS = RETAINED_CANDIDATES[0];

    /**
     * 工具定义和估算误差的固定预留 Token。
     */
    private static final long TOOL_OVERHEAD_RESERVE_TOKENS = 4096;

    /**
     * 新消息硬预算中为助手输出预留的上限。
     */
    private static final long MAX_OUTPUT_RESERVE_TOKENS = 32768;

    @Resource
    private ChatMemoryService chatMemoryService;
    @Resource
    private AiCodeService aiCodeService;
    @Resource
    private MemoryToolConclusionFormatter memoryToolConclusionFormatter;
    @Resource
    private ContextSummaryService contextSummaryService;
    @Resource
    private ModelOptionService modelOptionService;
    @Resource
    private ModelContextPreferenceService modelContextPreferenceService;
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SystemPromptService systemPromptService;

    /**
     * 每个 CHAT 执行 turn 结束时的固定工具压薄：同步、尽力、不影响聊天终态。
     */
    public void thinOldToolInteractions(String sessionId) {
        try {
            ChatMemory row = chatMemoryService.getById(sessionId);
            List<ChatMessage> messages = deserializeMessages(row);
            if (messages.isEmpty()) {
                return;
            }
            ThinResult result = thinParsed(ChatMemoryTurnParser.parse(messages), RETAINED_RAW_TURNS);
            if (!result.changed()) {
                return;
            }
            chatMemoryService.upsertMessagesJson(sessionId, serializeMessages(result.messages()));
            aiCodeService.evictChatMemory(sessionId);
            log.info("工具压薄完成 sessionId:{} 压薄工具调用数:{}", sessionId, result.compactedToolCallCount());
        } catch (Exception e) {
            // 压薄失败只记录日志，不能把已经完成的助手回复改成失败
            log.error("工具压薄失败 sessionId:{}", sessionId, e);
        }
    }

    /**
     * 聊天执行 turn 的前置上下文处理：pending 恢复、内存压薄、70% 自动压缩、新消息硬预算检查。
     *
     * @return 需要先于 USER_MESSAGE 推送的压缩事件和是否继续发送用户消息
     */
    public ChatPreparation prepareChatTurn(SessionTurn sessionTurn, String currentModelId, long currentContextLimit, String newUserMessage,
                                           SystemPromptSnapshot systemPromptSnapshot) {
        restorePendingCompressionEvent(sessionTurn.sessionId(), sessionTurn.transcriptUri());

        ChatMemory row = chatMemoryService.getById(sessionTurn.sessionId());
        List<ChatMessage> messages = deserializeMessages(row);
        ModelInfo currentModel = modelOptionService.requireModelInfo(currentModelId);

        List<SessionEvent> events = new ArrayList<>();
        ChatMemoryTurnParser.ParsedConversation parsed = ChatMemoryTurnParser.parse(messages);
        ThinResult thinned = thinParsed(parsed, RETAINED_RAW_TURNS);

        ContextUsageSnapshot lastUsage = parseLastUsage(row);
        if (lastUsage != null && turnsBeyondRetain(parsed) && reachTriggerRatio(lastUsage, row.getLastContextLimit(), currentContextLimit)) {
            String compressionId = IdUtil.getSnowflakeNextIdStr();
            long startNano = System.nanoTime();
            SessionEvent startedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.AUTO,
                    ContextCompressionPayload.State.STARTED, null, lastUsage, row.getLastContextLimit(), null, null);
            sessionEventStore.appendSession(sessionTurn.transcriptUri(), startedEvent);
            events.add(startedEvent);
            try {
                SessionEvent completedEvent = executeCompression(sessionTurn, row, parsed, thinned, currentModel, null,
                        ContextCompressionPayload.Trigger.AUTO, compressionId, startNano, lastUsage, null, systemPromptSnapshot);
                events.add(completedEvent);
                // 压缩成功后以提交后的上下文状态继续做硬预算检查
                row = chatMemoryService.getById(sessionTurn.sessionId());
                messages = deserializeMessages(row);
            } catch (ServiceException e) {
                SessionEvent failedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.AUTO,
                        ContextCompressionPayload.State.FAILED, null, lastUsage, row.getLastContextLimit(), DateTimeUtil.durationMs(startNano), e.getMessage());
                sessionEventStore.appendSession(sessionTurn.transcriptUri(), failedEvent);
                events.add(failedEvent);
                log.warn("自动上下文压缩失败 sessionId:{} compressionId:{} 原因:{}", sessionTurn.sessionId(), compressionId, e.getMessage());
                return new ChatPreparation(events, false);
            }
        } else if (thinned.changed()) {
            // 未达到摘要阈值时只提交确定性压薄，属于独立维护操作
            chatMemoryService.upsertMessagesJson(sessionTurn.sessionId(), serializeMessages(thinned.messages()));
            aiCodeService.evictChatMemory(sessionTurn.sessionId());
            messages = thinned.messages();
        }

        checkNewMessageBudget(currentModel, currentContextLimit, row == null ? null : row.getSummaryText(), messages, newUserMessage, systemPromptSnapshot);
        return new ChatPreparation(events, true);
    }

    /**
     * 主动上下文压缩：跳过 70% 阈值，复用执行 turn 互斥与 SSE 生命周期。
     * 取消时丢弃尚未提交的摘要调用结果；已提交的事务仍会把完成事件补进 JSONL。
     */
    public Flux<SessionEvent> manualCompress(SessionTurn sessionTurn, String fallbackModelName) {
        return Flux.defer(() -> {
            restorePendingCompressionEvent(sessionTurn.sessionId(), sessionTurn.transcriptUri());

            ChatMemory row = chatMemoryService.getById(sessionTurn.sessionId());
            List<ChatMessage> messages = deserializeMessages(row);
            ChatMemoryTurnParser.ParsedConversation parsed = ChatMemoryTurnParser.parse(messages);
            ThinResult thinned = thinParsed(parsed, RETAINED_RAW_TURNS);
            ContextUsageSnapshot lastUsage = parseLastUsage(row);

            String compressionId = IdUtil.getSnowflakeNextIdStr();
            long startNano = System.nanoTime();
            SystemPromptSnapshot systemPromptSnapshot;
            try {
                systemPromptSnapshot = systemPromptService.capture(sessionTurn.sessionId(), sessionTurn.workspacePath());
            } catch (ServiceException e) {
                SessionEvent failedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.MANUAL,
                        ContextCompressionPayload.State.FAILED, null, lastUsage, row == null ? null : row.getLastContextLimit(),
                        DateTimeUtil.durationMs(startNano), e.getMessage());
                log.warn("主动上下文压缩加载系统提示词失败 sessionId:{} compressionId:{} 原因:{}", sessionTurn.sessionId(), compressionId, e.getMessage());
                return Flux.just(sessionEventStore.appendSession(sessionTurn.transcriptUri(), failedEvent));
            }

            // 无可压缩内容时不调用模型；遗漏的确定性压薄仍然允许提交
            if (!turnsBeyondRetain(parsed) && !hasOversizedTurn(row, fallbackModelName, parsed)) {
                if (thinned.changed()) {
                    chatMemoryService.upsertMessagesJson(sessionTurn.sessionId(), serializeMessages(thinned.messages()));
                    aiCodeService.evictChatMemory(sessionTurn.sessionId());
                }
                SessionEvent skippedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.MANUAL,
                        ContextCompressionPayload.State.SKIPPED, null, lastUsage, row == null ? null : row.getLastContextLimit(),
                        DateTimeUtil.durationMs(startNano), null);
                ((ContextCompressionPayload) skippedEvent.getPayload()).setSkipReason("历史轮次不足，无需压缩");
                return Flux.just(sessionEventStore.appendSession(sessionTurn.transcriptUri(), skippedEvent));
            }

            SessionEvent startedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.MANUAL,
                    ContextCompressionPayload.State.STARTED, null, lastUsage, row == null ? null : row.getLastContextLimit(), null, null);
            sessionEventStore.appendSession(sessionTurn.transcriptUri(), startedEvent);

            AtomicBoolean cancelled = new AtomicBoolean();
            ChatMemory finalRow = row;
            Mono<SessionEvent> terminal = Mono.fromCallable(() -> {
                        try {
                            return executeCompression(sessionTurn, finalRow, parsed, thinned, null, fallbackModelName,
                                    ContextCompressionPayload.Trigger.MANUAL, compressionId, startNano, lastUsage, cancelled, systemPromptSnapshot);
                        } catch (ServiceException e) {
                            if (cancelled.get()) {
                                return null;
                            }
                            SessionEvent failedEvent = buildCompressionEvent(sessionTurn, compressionId, ContextCompressionPayload.Trigger.MANUAL,
                                    ContextCompressionPayload.State.FAILED, null, lastUsage, finalRow == null ? null : finalRow.getLastContextLimit(),
                                    DateTimeUtil.durationMs(startNano), e.getMessage());
                            log.warn("主动上下文压缩失败 sessionId:{} compressionId:{} 原因:{}", sessionTurn.sessionId(), compressionId, e.getMessage());
                            return sessionEventStore.appendSession(sessionTurn.transcriptUri(), failedEvent);
                        }
                    })
                    .subscribeOn(Schedulers.boundedElastic())
                    .doOnCancel(() -> cancelled.set(true));
            return Flux.concat(Flux.just(startedEvent), terminal);
        });
    }

    /**
     * 执行一次压缩：降级选择保留 turn、选择摘要模型、调用摘要、原子提交、幂等写完成事件。
     * 预期内失败抛 ServiceException，由调用方转换为 failed 事件。
     *
     * @param cancelled 主动压缩的取消标记；摘要返回后、事务提交前发现取消则放弃本次压缩（返回 null）
     * @return 完成事件；主动压缩在提交前被取消时返回 null
     */
    private SessionEvent executeCompression(SessionTurn sessionTurn, ChatMemory row,
                                            ChatMemoryTurnParser.ParsedConversation parsed, ThinResult normalThinned,
                                            ModelInfo currentModel, String fallbackModelName,
                                            ContextCompressionPayload.Trigger trigger, String compressionId, long startNano,
                                            ContextUsageSnapshot previousUsage, AtomicBoolean cancelled, SystemPromptSnapshot systemPromptSnapshot) {
        ModelInfo summaryModel = selectSummaryModel(row == null ? null : row.getLastModelId(), currentModel, fallbackModelName);
        if (summaryModel == null) {
            throw new ServiceException("没有可用的摘要模型");
        }
        long contextLimit = modelContextPreferenceService.getEffectiveContextLimit(summaryModel);
        String estimateModelId = summaryModel.modelId();

        String existingSummary = row == null ? null : row.getSummaryText();
        long systemTokens = ContextEstimateUtil.estimateTextTokens(estimateModelId, systemPromptService.compose(systemPromptSnapshot, existingSummary));

        // 降级顺序：先按 6 个保留（最近 4 个原始）；不足时压薄全部工具交互；再按 6、4、2、1 降低保留数量
        List<ConversationTurn> retainedTurns;
        int retainedCount;
        if (fitsBudget(contextLimit, estimateModelId, systemTokens, retainedTurnsOf(normalThinned.turns(), NORMAL_RETAINED_TURNS))) {
            retainedCount = Math.min(NORMAL_RETAINED_TURNS, normalThinned.turns().size());
            retainedTurns = retainedTurnsOf(normalThinned.turns(), retainedCount);
        } else {
            ThinResult fullyThinned = thinParsed(parsed, 0);
            retainedTurns = null;
            retainedCount = 0;
            for (int candidate : RETAINED_CANDIDATES) {
                int candidateCount = Math.min(candidate, fullyThinned.turns().size());
                List<ConversationTurn> candidateTurns = retainedTurnsOf(fullyThinned.turns(), candidateCount);
                if (fitsBudget(contextLimit, estimateModelId, systemTokens, candidateTurns)) {
                    retainedTurns = candidateTurns;
                    retainedCount = candidateCount;
                    break;
                }
            }
            if (retainedTurns == null) {
                throw new ServiceException("最近一轮对话过大，无法安全压缩，请发起新会话");
            }
        }

        int summarizedCount = parsed.turns().size() - retainedCount;
        List<ConversationTurn> summarizedTurns = new ArrayList<>(normalThinned.turns().subList(0, summarizedCount));
        boolean lowReasoning = supportsLowReasoning(summaryModel);
        Long outputLimit = summaryModel.limit() == null ? null : summaryModel.limit().output();
        String newSummary = contextSummaryService.summarize(summaryModel.modelId(), outputLimit, lowReasoning,
                existingSummary, parsed.orphanPrefix(), summarizedTurns);

        if (cancelled != null && cancelled.get()) {
            // 摘要已返回但客户端已断开：不提交、不写终态，JSONL 只保留 started，回放识别为中断
            return null;
        }

        List<ChatMessage> newMessages = new ArrayList<>(parsed.systemMessages());
        for (ConversationTurn turn : retainedTurns) {
            newMessages.addAll(turn.messages());
        }

        long beforeEstimatedTokens = systemTokens + ContextEstimateUtil.estimateMessagesTokens(estimateModelId, flattenTurns(parsed.turns()));
        long afterEstimatedTokens = ContextEstimateUtil.estimateTextTokens(estimateModelId, systemPromptService.compose(systemPromptSnapshot, newSummary))
                + ContextEstimateUtil.estimateMessagesTokens(estimateModelId, flattenTurns(retainedTurns));

        SessionEvent completedEvent = buildCompressionEvent(sessionTurn, compressionId, trigger,
                ContextCompressionPayload.State.COMPLETED, summaryModel.modelId(), previousUsage,
                row == null ? null : row.getLastContextLimit(), DateTimeUtil.durationMs(startNano), null);
        ContextCompressionPayload payload = (ContextCompressionPayload) completedEvent.getPayload();
        payload.setSummarizedTurnCount(summarizedCount);
        payload.setRetainedTurnCount(retainedCount);
        payload.setCompactedToolCallCount(countConcludedToolCalls(retainedTurns) + summarizedToolCalls(summarizedTurns));
        payload.setBeforeMessageCount(parsed.flatten().size());
        payload.setAfterMessageCount(newMessages.size());
        payload.setBeforeEstimatedTokens(beforeEstimatedTokens);
        payload.setAfterEstimatedTokens(afterEstimatedTokens);

        // 原子提交：消息、摘要、旧 usage 失效和待写完成事件在一个事务内更新
        chatMemoryService.commitCompressionSummary(sessionTurn.sessionId(), serializeMessages(newMessages), newSummary, JSON.toJSONString(completedEvent));
        aiCodeService.evictChatMemory(sessionTurn.sessionId());

        // 事务已提交：完成事件必须落 JSONL，失败时保留 pending 由下次会话操作补写
        sessionEventStore.appendSessionIdempotent(sessionTurn.transcriptUri(), completedEvent);
        chatMemoryService.clearPendingCompressionEvent(sessionTurn.sessionId());

        log.info("上下文压缩完成 sessionId:{} compressionId:{} trigger:{} 摘要 turn 数:{} 保留 turn 数:{} 耗时:{}ms",
                sessionTurn.sessionId(), compressionId, trigger.getCode(), summarizedCount, retainedCount, payload.getDurationMs());
        return completedEvent;
    }

    /**
     * 恢复已提交但未落入 JSONL 的压缩完成事件；未完成恢复前不允许写入新的用户消息。
     */
    private void restorePendingCompressionEvent(String sessionId, String transcriptUri) {
        ChatMemory row = chatMemoryService.getById(sessionId);
        String pending = row == null ? null : row.getPendingCompressionEventJson();
        if (StrUtil.isBlank(pending)) {
            return;
        }
        SessionEvent event = sessionEventStore.parseEvent(pending);
        sessionEventStore.appendSessionIdempotent(transcriptUri, event);
        chatMemoryService.clearPendingCompressionEvent(sessionId);
        log.info("补写压缩完成事件 sessionId:{} eventId:{}", sessionId, event.getEventId());
    }

    /**
     * 新用户消息硬预算检查：不截断、不摘要、不改写用户原文，超预算直接拒绝。
     */
    private void checkNewMessageBudget(ModelInfo currentModel, long contextLimit, String summaryText, List<ChatMessage> historyMessages,
                                       String newUserMessage, SystemPromptSnapshot systemPromptSnapshot) {
        long outputReserve = currentModel.limit().output() == null
                ? MAX_OUTPUT_RESERVE_TOKENS
                : Math.min(currentModel.limit().output(), MAX_OUTPUT_RESERVE_TOKENS);
        long available = contextLimit - outputReserve - TOOL_OVERHEAD_RESERVE_TOKENS;
        if (available <= 0) {
            return;
        }
        long estimated = ContextEstimateUtil.estimateTextTokens(currentModel.modelId(), systemPromptService.compose(systemPromptSnapshot, summaryText))
                + ContextEstimateUtil.estimateMessagesTokens(currentModel.modelId(), withoutSystemMessages(historyMessages))
                + ContextEstimateUtil.estimateTextTokens(currentModel.modelId(), newUserMessage);
        if (estimated > available) {
            throw new ServiceException("单条用户消息或剩余上下文超过输入预算，请压缩上下文或发起新会话");
        }
    }

    /**
     * 70% 触发判断：模型切换时取上一轮窗口和本次窗口的较大压力，对小窗口保持保守。
     */
    private boolean reachTriggerRatio(ContextUsageSnapshot lastUsage, Long previousContextLimit, long currentContextLimit) {
        double currentRatio = (double) lastUsage.totalTokens() / currentContextLimit;
        double ratio = currentRatio;
        if (previousContextLimit != null && previousContextLimit > 0) {
            ratio = Math.max(ratio, (double) lastUsage.totalTokens() / previousContextLimit);
        }
        return ratio >= AUTO_TRIGGER_RATIO;
    }

    private boolean fitsBudget(Long contextLimit, String modelId, long systemTokens, List<ConversationTurn> retainedTurns) {
        if (contextLimit == null || contextLimit <= 0) {
            return true;
        }
        long estimated = systemTokens + ContextEstimateUtil.estimateMessagesTokens(modelId, flattenTurns(retainedTurns));
        return estimated <= contextLimit * POST_COMPRESSION_TARGET_RATIO;
    }

    private boolean turnsBeyondRetain(ChatMemoryTurnParser.ParsedConversation parsed) {
        return parsed.turns().size() > NORMAL_RETAINED_TURNS;
    }

    /**
     * 主动压缩的超大 turn 判断：任一 turn 估算超过窗口一半即视为需要压缩。
     */
    private boolean hasOversizedTurn(ChatMemory row, String fallbackModelName, ChatMemoryTurnParser.ParsedConversation parsed) {
        ModelInfo model = selectSummaryModel(row == null ? null : row.getLastModelId(), null, fallbackModelName);
        if (model == null) return false;
        long contextLimit = modelContextPreferenceService.getEffectiveContextLimit(model);
        for (ConversationTurn turn : parsed.turns()) {
            long estimated = ContextEstimateUtil.estimateMessagesTokens(model.modelId(), turn.messages());
            if (estimated > contextLimit * POST_COMPRESSION_TARGET_RATIO) {
                return true;
            }
        }
        return false;
    }

    /**
     * 摘要模型选择：上一轮模型优先且仍在目录中；否则回退本次聊天模型或主动请求模型。
     */
    private ModelInfo selectSummaryModel(String lastModelId, ModelInfo currentModel, String fallbackModelName) {
        Map<String, ModelInfo> catalog = modelOptionService.getModelInfoMap();
        if (StrUtil.isNotBlank(lastModelId)) {
            ModelInfo last = catalog.get(lastModelId.trim());
            if (last != null) {
                return last;
            }
        }
        if (currentModel != null) {
            return currentModel;
        }
        if (StrUtil.isNotBlank(fallbackModelName)) {
            return catalog.get(fallbackModelName.trim());
        }
        return null;
    }

    private boolean supportsLowReasoning(ModelInfo modelInfo) {
        for (Map<String, Object> option : modelInfo.reasoningOptions()) {
            if (!"effort".equals(option.get("type")) || !(option.get("values") instanceof List<?> values)) {
                continue;
            }
            for (Object value : values) {
                if ("low".equals(value)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 工具压薄：最近 keepRawTurns 个历史 turn 保持原样，更早 turn 的工具请求与结果改写为结论版。
     */
    private ThinResult thinParsed(ChatMemoryTurnParser.ParsedConversation parsed, int keepRawTurns) {
        int thinBoundary = parsed.turns().size() - Math.max(keepRawTurns, 0);
        if (thinBoundary <= 0) {
            return new ThinResult(parsed.flatten(), parsed.turns(), 0, false);
        }
        List<ConversationTurn> newTurns = new ArrayList<>(parsed.turns().size());
        int compacted = 0;
        for (int i = 0; i < parsed.turns().size(); i++) {
            ConversationTurn turn = parsed.turns().get(i);
            if (i >= thinBoundary || turn.toolCallCount() == 0) {
                newTurns.add(turn);
                continue;
            }
            ThinTurnResult result = thinTurn(turn);
            newTurns.add(result.turn());
            compacted += result.compactedToolCallCount();
        }
        List<ChatMessage> newMessages = new ArrayList<>(parsed.systemMessages());
        newMessages.addAll(parsed.orphanPrefix());
        for (ConversationTurn turn : newTurns) {
            newMessages.addAll(turn.messages());
        }
        return new ThinResult(newMessages, newTurns, compacted, compacted > 0);
    }

    /**
     * 压薄单个 turn 内的全部工具组；配对不可靠时保留原文，不为缩短上下文制造非法消息序列。
     */
    private ThinTurnResult thinTurn(ConversationTurn turn) {
        List<ChatMessage> messages = turn.messages();
        List<ChatMessage> out = new ArrayList<>(messages.size());
        int compacted = 0;
        for (int i = 0; i < messages.size(); i++) {
            ChatMessage message = messages.get(i);
            if (message instanceof AiMessage aiMessage && aiMessage.hasToolExecutionRequests()) {
                List<ToolExecutionRequest> requests = aiMessage.toolExecutionRequests();
                Set<String> expectedIds = new HashSet<>();
                for (ToolExecutionRequest request : requests) {
                    expectedIds.add(request.id());
                }
                List<ToolExecutionResultMessage> results = new ArrayList<>();
                int j = i + 1;
                while (j < messages.size() && messages.get(j) instanceof ToolExecutionResultMessage resultMessage && expectedIds.contains(resultMessage.id())) {
                    results.add(resultMessage);
                    j++;
                }
                if (results.size() != requests.size()) {
                    log.warn("历史工具组配对不完整，保留原文 toolCallIds:{}", expectedIds);
                    return new ThinTurnResult(turn, 0);
                }
                boolean allConcluded = results.stream().allMatch(item -> memoryToolConclusionFormatter.isMemoryConclusion(item.text()));
                if (allConcluded) {
                    out.add(message);
                    out.addAll(results);
                } else {
                    List<ToolExecutionRequest> summarized = requests.stream()
                            .map(request -> ToolExecutionRequest.builder()
                                    .id(request.id())
                                    .name(request.name())
                                    .arguments(memoryToolConclusionFormatter.summarizeArguments(request.name(), request.arguments()))
                                    .build())
                            .toList();
                    out.add(AiMessage.builder().text(aiMessage.text()).toolExecutionRequests(summarized).build());
                    for (ToolExecutionResultMessage resultMessage : results) {
                        if (memoryToolConclusionFormatter.isMemoryConclusion(resultMessage.text())) {
                            out.add(resultMessage);
                        } else {
                            out.add(new ToolExecutionResultMessage(resultMessage.id(), resultMessage.toolName(),
                                    memoryToolConclusionFormatter.concludeResult(resultMessage.toolName(), resultMessage.text())));
                            compacted++;
                        }
                    }
                }
                i = j - 1;
            } else if (message instanceof ToolExecutionResultMessage orphanResult) {
                log.warn("发现无对应请求的工具结果，保留本 turn 原文 toolCallId:{}", orphanResult.id());
                return new ThinTurnResult(turn, 0);
            } else {
                out.add(message);
            }
        }
        if (compacted == 0) {
            return new ThinTurnResult(turn, 0);
        }
        return new ThinTurnResult(rebuildTurn(out), compacted);
    }

    private ConversationTurn rebuildTurn(List<ChatMessage> messages) {
        return ChatMemoryTurnParser.parse(messages).turns().getFirst();
    }

    private int countConcludedToolCalls(List<ConversationTurn> turns) {
        int compacted = 0;
        for (ConversationTurn turn : turns) {
            for (ChatMessage message : turn.messages()) {
                if (message instanceof ToolExecutionResultMessage resultMessage && memoryToolConclusionFormatter.isMemoryConclusion(resultMessage.text())) {
                    compacted++;
                }
            }
        }
        return compacted;
    }

    private int summarizedToolCalls(List<ConversationTurn> summarizedTurns) {
        int count = 0;
        for (ConversationTurn turn : summarizedTurns) {
            count += turn.toolCallCount();
        }
        return count;
    }

    private List<ConversationTurn> retainedTurnsOf(List<ConversationTurn> turns, int count) {
        if (count >= turns.size()) {
            return new ArrayList<>(turns);
        }
        return new ArrayList<>(turns.subList(turns.size() - count, turns.size()));
    }

    private List<ChatMessage> flattenTurns(List<ConversationTurn> turns) {
        List<ChatMessage> messages = new ArrayList<>();
        for (ConversationTurn turn : turns) {
            messages.addAll(turn.messages());
        }
        return messages;
    }

    private List<ChatMessage> withoutSystemMessages(List<ChatMessage> messages) {
        return messages.stream().filter(message -> !(message instanceof SystemMessage)).toList();
    }

    private SessionEvent buildCompressionEvent(SessionTurn sessionTurn, String compressionId, ContextCompressionPayload.Trigger trigger,
                                               ContextCompressionPayload.State state, String modelId, ContextUsageSnapshot previousUsage,
                                               Long previousContextLimit, Long durationMs, String errorMessage) {
        return SessionEvent.builder()
                .eventId(IdUtil.getSnowflakeNextIdStr())
                .sessionId(sessionTurn.sessionId())
                .turnId(sessionTurn.turnId())
                .type(SessionEventType.CONTEXT_COMPRESSION)
                .source(SessionEventSource.SYSTEM)
                .createdAt(DateTimeUtil.now())
                .payload(ContextCompressionPayload.builder()
                        .compressionId(compressionId)
                        .trigger(trigger)
                        .state(state)
                        .modelId(modelId)
                        .previousUsage(previousUsage)
                        .previousContextLimit(previousContextLimit)
                        .durationMs(durationMs)
                        .errorMessage(errorMessage)
                        .build())
                .meta(Collections.emptyMap())
                .build();
    }

    private ContextUsageSnapshot parseLastUsage(ChatMemory row) {
        if (row == null || StrUtil.isBlank(row.getLastContextUsageJson())) {
            return null;
        }
        try {
            ContextUsageSnapshot usage = JSON.parseObject(row.getLastContextUsageJson(), ContextUsageSnapshot.class);
            if (usage == null || usage.totalTokens() == null || usage.totalTokens() <= 0) {
                return null;
            }
            return usage;
        } catch (RuntimeException e) {
            log.warn("历史 usage JSON 解析失败，按缺失处理 memoryId:{}", row.getMemoryId());
            return null;
        }
    }

    private List<ChatMessage> deserializeMessages(ChatMemory row) {
        if (row == null || StrUtil.isBlank(row.getMessagesJson())) {
            return Collections.emptyList();
        }
        return ChatMessageDeserializer.messagesFromJson(row.getMessagesJson());
    }

    private String serializeMessages(List<ChatMessage> messages) {
        return ChatMessageSerializer.messagesToJson(messages);
    }

    /**
     * 聊天前置处理结果。
     */
    public record ChatPreparation(List<SessionEvent> events, boolean proceed) {
    }

    private record ThinResult(List<ChatMessage> messages, List<ConversationTurn> turns, int compactedToolCallCount, boolean changed) {
    }

    private record ThinTurnResult(ConversationTurn turn, int compactedToolCallCount) {
    }
}
