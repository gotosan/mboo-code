package com.yu.mboocode.agent.dto;

import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.ContextUsageSnapshot;
import dev.langchain4j.model.chat.response.StreamingHandle;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * 当前进程内活跃 turn 的运行时状态。
 *
 * <p>该对象不持久化，用于协调 Flux 订阅、模型取消和终态竞争。数据库中的 active_turn_id
 * 只负责持久化占用，不能代替本对象判断 turn 是否仍然存活。</p>
 */
@Schema(description = "活跃 turn 运行时状态")
public class ActiveTurnRuntime {
    private static final long STARTING_TIMEOUT_NANOS = Duration.ofSeconds(30).toNanos();

    @Schema(description = "当前 turn 上下文")
    private final SessionTurn sessionTurn;

    @Schema(description = "当前运行阶段", hidden = true)
    private final AtomicReference<TurnPhase> phase = new AtomicReference<>(TurnPhase.STARTING);

    @Schema(description = "完成、错误或取消中首先生效的终态", hidden = true)
    private final AtomicReference<TurnTerminalState> terminalState = new AtomicReference<>();

    @Schema(description = "助手终态事件是否已处理", hidden = true)
    private final AtomicBoolean assistantTerminalHandled = new AtomicBoolean();

    @Schema(description = "外层系统终态事件是否已处理", hidden = true)
    private final AtomicBoolean systemTerminalHandled = new AtomicBoolean();

    @Schema(description = "当前模型流取消句柄", hidden = true)
    private final AtomicReference<StreamingHandle> streamingHandle = new AtomicReference<>();

    @Schema(description = "当前 turn 使用的模型 ID", hidden = true)
    private final AtomicReference<String> modelId = new AtomicReference<>();

    @Schema(description = "当前 turn 使用的生效上下文上限", hidden = true)
    private final AtomicReference<Long> contextLimit = new AtomicReference<>();

    @Schema(description = "当前助手消息 ID", hidden = true)
    private final AtomicReference<String> assistantMessageId = new AtomicReference<>();

    @Schema(description = "AI Service invocation ID", hidden = true)
    private final AtomicReference<UUID> invocationId = new AtomicReference<>();

    @Schema(description = "最后一次有效上下文用量", hidden = true)
    private final AtomicReference<ContextUsageSnapshot> latestContextUsage = new AtomicReference<>();

    @Schema(description = "上下文用量 SSE 发送器", hidden = true)
    private final AtomicReference<Consumer<ContextUsageSnapshot>> contextUsageEmitter = new AtomicReference<>();

    public ActiveTurnRuntime(SessionTurn sessionTurn) {
        this.sessionTurn = sessionTurn;
    }

    public SessionTurn getSessionTurn() {
        return sessionTurn;
    }

    /**
     * 只允许第一次订阅把 turn 从待启动切换为运行中，避免同一个 Flux 被重复订阅。
     */
    public boolean markRunning() {
        return phase.compareAndSet(TurnPhase.STARTING, TurnPhase.RUNNING);
    }

    /**
     * 回收创建后长期未订阅的 turn；CAS 用于避免与正常订阅同时取得执行权。
     */
    public boolean tryReclaimStarting() {
        long elapsedNanos = System.nanoTime() - sessionTurn.startNano();
        return elapsedNanos >= STARTING_TIMEOUT_NANOS && phase.compareAndSet(TurnPhase.STARTING, TurnPhase.TERMINATING);
    }

    /**
     * 选择唯一终态。相同终态允许内外层继续补齐各自事件，不同终态只有先到者生效。
     */
    public boolean acceptTerminal(TurnTerminalState expectedState) {
        TurnTerminalState currentState = terminalState.compareAndExchange(null, expectedState);
        if (currentState != null && currentState != expectedState) {
            return false;
        }
        phase.updateAndGet(currentPhase -> currentPhase == TurnPhase.TERMINATED ? TurnPhase.TERMINATED : TurnPhase.TERMINATING);
        return true;
    }

    /**
     * 取得助手终态事件的唯一处理权。
     */
    public boolean claimAssistantTerminal(TurnTerminalState expectedState) {
        return acceptTerminal(expectedState) && assistantTerminalHandled.compareAndSet(false, true);
    }

    /**
     * 取得外层错误或取消事件的唯一处理权。
     */
    public boolean claimSystemTerminal(TurnTerminalState expectedState) {
        return acceptTerminal(expectedState) && systemTerminalHandled.compareAndSet(false, true);
    }

    /**
     * 保存模型流句柄；如果取消已经先发生，句柄到达后立即补执行取消。
     */
    public void setStreamingHandle(StreamingHandle handle) {
        streamingHandle.set(handle);
        if (terminalState.get() == TurnTerminalState.CANCEL) {
            handle.cancel();
        }
    }

    public void cancelStreaming() {
        StreamingHandle handle = streamingHandle.get();
        if (handle != null) {
            handle.cancel();
        }
    }

    public void configureModelUsage(String currentModelId, Long currentContextLimit, String currentAssistantMessageId, Consumer<ContextUsageSnapshot> emitter) {
        modelId.set(currentModelId);
        contextLimit.set(currentContextLimit);
        assistantMessageId.set(currentAssistantMessageId);
        contextUsageEmitter.set(emitter);
    }

    public String getModelId() {
        return modelId.get();
    }

    public Long getContextLimit() {
        return contextLimit.get();
    }

    public String getAssistantMessageId() {
        return assistantMessageId.get();
    }

    public boolean bindInvocation(UUID currentInvocationId) {
        UUID existing = invocationId.compareAndExchange(null, currentInvocationId);
        return existing == null || existing.equals(currentInvocationId);
    }

    public boolean matchesInvocation(UUID currentInvocationId) {
        UUID existing = invocationId.get();
        return existing != null && existing.equals(currentInvocationId);
    }

    public void updateContextUsage(ContextUsageSnapshot snapshot) {
        latestContextUsage.set(snapshot);
        Consumer<ContextUsageSnapshot> emitter = contextUsageEmitter.get();
        if (emitter != null) emitter.accept(snapshot);
    }

    public ContextUsageSnapshot getLatestContextUsage() {
        return latestContextUsage.get();
    }

    public boolean isUsageTrackingActive() {
        return terminalState.get() == null && phase.get() != TurnPhase.TERMINATED;
    }

    public void clearContextUsageEmitter() {
        contextUsageEmitter.set(null);
    }

    public void finish() {
        phase.set(TurnPhase.TERMINATED);
    }

    @Schema(description = "turn 运行阶段")
    public enum TurnPhase {
        STARTING, //已创建，等待 Flux 订阅
        RUNNING, //已订阅，正在执行
        TERMINATING, //已选定终态，正在清理
        TERMINATED //清理完成
    }

    @Schema(description = "turn 终态")
    public enum TurnTerminalState {
        COMPLETE, //正常完成
        ERROR, //异常结束
        CANCEL //用户取消
    }
}
