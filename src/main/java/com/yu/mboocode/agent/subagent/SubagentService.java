package com.yu.mboocode.agent.subagent;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.enums.*;
import com.yu.mboocode.agent.model.*;
import com.yu.mboocode.agent.model.payload.*;
import com.yu.mboocode.agent.service.*;
import com.yu.mboocode.agent.tool.ToolInvocationContext;
import com.yu.mboocode.common.util.DateTimeUtil;
import jakarta.annotation.Resource;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import static com.yu.mboocode.agent.subagent.SubagentRun.Status.*;

/** 只调度执行容量；不分析委派文字、不锁定文件、不重放有副作用的任务。 */
@Service
public class SubagentService {
    @Resource
    private SubagentRunStore store;
    @Resource
    private SessionService sessionService;
    @Resource
    private AgentExecutionRegistry registry;
    @Resource
    private ConversationForkService forkService;
    @Resource
    private SessionEventStore eventStore;
    @Resource
    private ToolResultStore resultStore;
    @Resource
    private PlatformTransactionManager transactionManager;
    @Resource
    @Lazy
    private TurnService turnService;
    private final Map<String, SubagentRun> active = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> deliveryCandidates = new ConcurrentHashMap<>();

    public Object spawn(String role, String message, Boolean fork, String mode) { return delegate(null, role, message, Boolean.TRUE.equals(fork), mode); }
    public Object send(String agentId, String message, String mode) {
        if (StrUtil.isBlank(agentId)) throw new SubagentException("INVALID_ARGUMENT", "agentId 不能为空");
        return delegate(agentId, null, message, false, mode);
    }

    public synchronized void bindChildTurn(String agentId, String turnId) {
        SubagentRun run = active.values().stream().filter(item -> agentId.equals(item.getAgentId())).findFirst().orElseThrow();
        run.setChildTurnId(turnId);
        registry.get(agentId).runId = run.getRunId();
        store.updateById(run);
    }

    private Object delegate(String agentId, String role, String message, boolean fork, String mode) {
        var caller = caller();
        var invocation = ToolInvocationContext.current();
        if (StrUtil.isBlank(message)) throw new SubagentException("INVALID_ARGUMENT", "委派消息不能为空");
        SubagentRun run;
        synchronized (this) {
            String key = caller.turn.sessionId() + ":" + caller.turn.turnId() + ":" + invocation.toolCallId() + ":" + (agentId == null ? "spawn_agent" : "send_agent_message");
            if (caller.cancelled.get()) throw new SubagentException("SUBAGENT_CANCELLED", "父执行已取消");
            run = store.lambdaQuery().eq(SubagentRun::getInvocationKey, key).one();
            if (run == null) {
                if (agentId != null) {
                    sessionService.requireManagedChild(caller.turn.sessionId(), agentId);
                    role = AgentIdentity.from(sessionService.getSession(agentId)).agentRole();
                }
                try { AgentDefinition.require(role); } catch (IllegalArgumentException e) { throw new SubagentException("INVALID_ARGUMENT", e.getMessage()); }
                String effectiveMode = StrUtil.isBlank(mode) ? ("explorer".equals(role) ? "background" : "foreground") : mode;
                if (!Set.of("foreground", "background").contains(effectiveMode) || ("worker".equals(role) && !"foreground".equals(effectiveMode))) throw new SubagentException("INVALID_AGENT_MODE", "worker 仅支持 foreground；explorer 支持 foreground/background");
                List<SubagentRun> existing = store.byParent(caller.turn.sessionId(), caller.turn.turnId());
                if (existing.size() >= 12) throw new SubagentException("SUBAGENT_RUN_LIMIT", "本父轮次累计执行已达 12 次");
                if (active.size() >= 6 || existing.stream().filter(item -> !item.terminal()).count() >= 3) throw new SubagentException("SUBAGENT_CONCURRENCY_LIMIT", "子执行并发已满，本轮活动执行：" + existing.stream().filter(item -> !item.terminal()).map(SubagentRun::getRunId).toList());
                String selectedAgentId = agentId;
                if (agentId != null && active.values().stream().anyMatch(item -> selectedAgentId.equals(item.getAgentId()))) throw new SubagentException("AGENT_BUSY", "子会话正在执行，请先等待当前 run 结束");
                ConversationForkService.Snapshot snapshot = fork ? forkService.captureSnapshot(caller.turn.sessionId(), caller.turn.turnId(), invocation.toolCallId()) : null;
                run = new SubagentRun();
                run.setRunId(IdUtil.getSnowflakeNextIdStr());
                run.setAgentId(agentId == null ? IdUtil.getSnowflakeNextIdStr() : agentId);
                run.setParentSessionId(caller.turn.sessionId());
                run.setParentTurnId(caller.turn.turnId());
                run.setParentMessageId(caller.messageId);
                run.setParentToolCallId(invocation.toolCallId());
                run.setInvocationKey(key);
                run.setRole(role);
                run.setMode(effectiveMode);
                run.setModelId(caller.parameters.modelName());
                if (caller.parameters instanceof dev.langchain4j.model.openai.OpenAiResponsesChatRequestParameters parameters) run.setReasoningEffort(parameters.reasoningEffort());
                run.setStatus(STARTING);
                run.setVersion(1);
                run.setCreatedAt(DateTimeUtil.now());
                run.setUpdatedAt(run.getCreatedAt());
                store.save(run);
                active.put(run.getRunId(), run);
                publish(run);
                SubagentRun accepted = run;
                boolean newAgent = agentId == null;
                Thread.startVirtualThread(() -> execute(accepted, message, newAgent, snapshot, caller));
            } else if (active.containsKey(run.getRunId())) run = active.get(run.getRunId());
        }
        if ("foreground".equals(run.getMode())) await(List.of(run.getRunId()), null, caller);
        return result(run.getRunId(), invocation.toolCallId(), caller);
    }

    private void execute(SubagentRun run, String message, boolean newAgent, ConversationForkService.Snapshot snapshot, AgentExecutionRegistry.Execution parent) {
        try {
            if (newAgent) {
                // SQLite 延迟事务先读再写会在并发创建时升级锁失败；父信息在事务外读取，事务从目标插入开始。
                Sessions parentSession = sessionService.getSession(run.getParentSessionId());
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    sessionService.createChildSession(run.getAgentId(), parentSession, run.getRole(), snapshot == null ? null : snapshot.forkPointId());
                    if (snapshot != null) forkService.initializeContext(run.getAgentId(), snapshot, run.getParentSessionId());
                    store.updateById(run);
                });
            }
            synchronized (this) {
                if (run.getStatus() == CANCELLING || parent.cancelled.get()) { finish(run, CANCELLED, null); return; }
            }
            var execution = turnService.childTurn(run.getAgentId(), parent.turn, childTurn -> {
                synchronized (this) {
                    run.setChildTurnId(childTurn.turnId());
                    var child = registry.require(run.getAgentId());
                    child.runId = run.getRunId();
                    if (run.getStatus() == CANCELLING || parent.cancelled.get()) throw new SubagentException("SUBAGENT_CANCELLED", "父执行已取消");
                    change(run, RUNNING);
                }
                return turnService.chatStream(childTurn, message, parent.parameters);
            });
            execution.doOnNext(event -> childEvent(run, event)).blockLast();
            turnService.awaitFinished(run.getAgentId(), run.getChildTurnId()).block();
            synchronized (this) {
                finish(run, run.getStatus() == CANCELLING ? CANCELLED : run.getErrorCode() == null ? SUCCEEDED : FAILED, null);
            }
        } catch (Throwable error) {
            synchronized (this) {
                if (run.terminal()) return;
                run.setErrorCode(error instanceof SubagentException ? JSON.parseObject(error.getMessage()).getString("errorCode") : "SUBAGENT_EXECUTION_FAILED");
                run.setErrorMessage(StrUtil.blankToDefault(error.getMessage(), "子执行失败"));
            }
            try {
                if (run.getChildTurnId() != null) turnService.cancelTurn(run.getAgentId(), run.getChildTurnId()).block();
                synchronized (this) { finish(run, run.getStatus() == CANCELLING ? CANCELLED : FAILED, error); }
            } catch (Throwable cleanupError) {
                synchronized (this) {
                    run.setErrorMessage("子执行清理尚未确认：" + cleanupError.getMessage());
                    try { change(run, run.getStatus() == CANCELLING ? CANCELLING : FINALIZING); }
                    catch (RuntimeException ignored) { /* 存储暂不可用时仍保留活动名额，下面继续重试。 */ }
                }
                Thread.startVirtualThread(() -> {
                    while (!run.terminal()) {
                        try {
                            Thread.sleep(1000);
                            if (run.getChildTurnId() != null) turnService.cancelTurn(run.getAgentId(), run.getChildTurnId()).block();
                            synchronized (this) { finish(run, run.getStatus() == CANCELLING ? CANCELLED : FAILED, error); }
                        } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
                        catch (RuntimeException ignored) { /* 清理和终态落盘都成功之前不可释放容量。 */ }
                    }
                });
            }
        }
    }

    private void childEvent(SubagentRun run, SessionEvent event) {
        synchronized (this) {
            if (run.terminal()) return;
            if (event.getPayload() instanceof AssistantMessagePayload payload) {
                run.setFinalText(payload.getText());
                if (payload.getState() == AssistantMessagePayload.AssistantMessageState.ERROR) {
                    run.setErrorCode("SUBAGENT_EXECUTION_FAILED");
                    run.setErrorMessage(payload.getErrorMessage());
                }
            } else if (event.getPayload() instanceof ErrorPayload payload) {
                run.setErrorCode("SUBAGENT_EXECUTION_FAILED");
                run.setErrorMessage(payload.getErrorMessage());
            } else if (event.getType() == SessionEventType.CANCELLED) change(run, CANCELLING);
            else if (event.getPayload() instanceof ContextCompressionPayload payload && "failed".equals(payload.getState().getCode())) {
                run.setErrorCode("CONTEXT_LIMIT_EXCEEDED");
                run.setErrorMessage("子上下文准备失败，请查看子会话压缩记录");
            }
            if (event.getType() == SessionEventType.TOOL_APPROVAL_REQUIRED && run.getStatus() == RUNNING) change(run, WAITING_APPROVAL);
            else if (event.getType() == SessionEventType.TOOL_CALL_STARTED && run.getStatus() == WAITING_APPROVAL) change(run, RUNNING);
        }
        emit(run, SessionEventType.SUBAGENT_EVENT, new SubagentEventPayload(run.getAgentId(), run.getRunId(), event));
    }

    public Object waitAgents(List<String> runIds, Long timeoutMs) {
        var parent = caller();
        long timeout = timeoutMs == null ? 30_000 : timeoutMs;
        if (runIds == null || runIds.isEmpty() || runIds.size() > 12 || new HashSet<>(runIds).size() != runIds.size() || timeout < 0 || timeout > 60_000) throw new SubagentException("INVALID_ARGUMENT", "runIds 需为 1～12 个不同 ID，timeoutMs 范围为 0～60000");
        synchronized (this) { runIds.forEach(id -> managed(id, parent.turn.sessionId())); }
        boolean timedOut = !await(runIds, timeout, parent);
        return Map.of("runs", runIds.stream().map(id -> result(id, ToolInvocationContext.current().toolCallId(), parent)).toList(), "timedOut", timedOut);
    }

    private boolean await(List<String> ids, Long timeoutMs, AgentExecutionRegistry.Execution parent) {
        long deadline = timeoutMs == null ? Long.MAX_VALUE : System.nanoTime() + timeoutMs * 1_000_000;
        synchronized (this) {
            while (ids.stream().noneMatch(id -> managed(id, parent.turn.sessionId()).terminal())) {
                if (parent.cancelled.get()) throw new SubagentException("SUBAGENT_CANCELLED", "父执行已取消");
                if (System.nanoTime() >= deadline) return false;
                try { wait(Math.max(1, Math.min(200, (deadline - System.nanoTime()) / 1_000_000))); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new SubagentException("SUBAGENT_CANCELLED", "等待子执行被中断"); }
            }
            return true;
        }
    }

    public Object cancel(String runId) {
        var parent = caller();
        cancelManaged(parent.turn.sessionId(), runId);
        return result(runId, ToolInvocationContext.current().toolCallId(), parent);
    }

    public SubagentRun cancelManaged(String parentSessionId, String runId) {
        SubagentRun run;
        synchronized (this) {
            run = managed(runId, parentSessionId);
            if (run.terminal()) return run;
            var execution = registry.get(run.getAgentId());
            if (execution != null) execution.cancelled.set(true);
            change(run, CANCELLING);
        }
        SubagentRun target = run;
        Thread.startVirtualThread(() -> {
            try {
                if (target.getChildTurnId() != null) turnService.cancelTurn(target.getAgentId(), target.getChildTurnId()).block();
            } catch (RuntimeException ignored) { /* 由执行清理流程保留错误和取消中状态。 */ }
        });
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        synchronized (this) {
            while (!run.terminal() && System.nanoTime() < deadline) {
                try { wait(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            return JSON.parseObject(JSON.toJSONString(run), SubagentRun.class);
        }
    }

    public void cancelChildren(String sessionId, String turnId) {
        List<SubagentRun> children = active.values().stream().filter(run -> sessionId.equals(run.getParentSessionId()) && turnId.equals(run.getParentTurnId())).toList();
        for (SubagentRun run : children) {
            synchronized (this) {
                if (!run.terminal()) {
                    var execution = registry.get(run.getAgentId());
                    if (execution != null) execution.cancelled.set(true);
                    change(run, CANCELLING);
                }
            }
            if (run.getChildTurnId() != null) turnService.cancelTurn(run.getAgentId(), run.getChildTurnId()).block();
        }
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        synchronized (this) {
            while (children.stream().anyMatch(run -> !run.terminal()) && System.nanoTime() < deadline) {
                try { wait(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            if (children.stream().anyMatch(run -> !run.terminal())) throw new IllegalStateException("子执行仍在清理，尚未完全停止");
        }
    }

    public synchronized String joinInstruction(AgentExecutionRegistry.Execution parent) {
        if (parent.child()) return null;
        var outstanding = store.byParent(parent.turn.sessionId(), parent.turn.turnId()).stream().filter(run -> !run.terminal() || run.getDeliveryToolCallId() == null).toList();
        if (outstanding.isEmpty()) return null;
        return "当前父轮次尚未收齐子执行结果。请调用 wait_agents（只等待尚未取得结果的 runId）或 cancel_agent，读取全部结果后再最终答复。真实状态："
                + JSON.toJSONString(outstanding.stream().map(run -> Map.of("runId", run.getRunId(), "status", run.getStatus(), "delivered", run.getDeliveryToolCallId() != null)).toList());
    }

    public synchronized void confirmDelivery(String sessionId, String turnId, List<dev.langchain4j.data.message.ChatMessage> messages) {
        for (var message : messages) {
            if (!(message instanceof dev.langchain4j.data.message.ToolExecutionResultMessage result)) continue;
            Set<String> ids = deliveryCandidates.remove(sessionId + ":" + turnId + ":" + result.id());
            if (ids == null) continue;
            for (String id : ids) {
                SubagentRun run = managed(id, sessionId);
                if (!run.terminal()) continue;
                run.setDeliveryToolCallId(result.id());
                store.updateById(run);
            }
        }
    }

    public void releaseTurn(String sessionId, String turnId) { deliveryCandidates.keySet().removeIf(key -> key.startsWith(sessionId + ":" + turnId + ":")); }

    public synchronized Object result(String runId, String deliveryToolId, AgentExecutionRegistry.Execution parent) {
        SubagentRun run = managed(runId, parent.turn.sessionId());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("agentId", run.getAgentId()); result.put("runId", runId); result.put("status", run.getStatus());
        result.put("cleanupPending", run.getStatus() == CANCELLING || run.getStatus() == FINALIZING);
        if (run.terminal()) {
            String text = StrUtil.nullToEmpty(run.getFinalText());
            Map<String, Object> content = new LinkedHashMap<>();
            content.put("finalText", text.length() > 16_000 ? text.substring(0, 16_000) : text);
            content.put("truncated", text.length() > 16_000);
            content.put("artifactRefs", run.getResultId() == null ? List.of() : List.of(Map.of("sessionId", run.getAgentId(), "resultId", run.getResultId(), "path", resultStore.resultFilePath(run.getAgentId(), run.getResultId()).toString())));
            content.put("usage", run.getUsage() == null ? null : JSON.parseObject(run.getUsage()));
            result.put("result", content);
            if (deliveryToolId != null) deliveryCandidates.computeIfAbsent(parent.turn.sessionId() + ":" + parent.turn.turnId() + ":" + deliveryToolId, key -> ConcurrentHashMap.newKeySet()).add(runId);
        }
        result.put("error", run.getErrorCode() == null ? null : Map.of("code", run.getErrorCode(), "message", StrUtil.nullToEmpty(run.getErrorMessage())));
        return result;
    }

    public synchronized void captureUsage(String sessionId) {
        var execution = registry.get(sessionId);
        if (execution == null || execution.runId == null) return;
        SubagentRun run = active.get(execution.runId);
        if (run != null && execution.totalTokens != null) run.setUsage(JSON.toJSONString(new ContextUsageSnapshot(run.getModelId(), execution.inputTokens, execution.outputTokens, execution.totalTokens)));
    }

    public synchronized void approvalUpdated(String sessionId, String turnId, String toolCallId, String approvalId) {
        var execution = registry.get(sessionId);
        if (execution == null || execution.runId == null) return;
        SubagentRun run = active.get(execution.runId);
        if (run == null || run.terminal()) return;
        if (run.getStatus() == WAITING_APPROVAL) change(run, RUNNING);
        emit(run, SessionEventType.SUBAGENT_APPROVAL_UPDATED, new SubagentApprovalUpdatedPayload(sessionId, run.getRunId(), approvalId, turnId, toolCallId, false));
    }

    private void finish(SubagentRun run, SubagentRun.Status terminal, Throwable error) {
        if (run.terminal()) return;
        change(run, run.getStatus() == CANCELLING ? CANCELLING : FINALIZING);
        Sessions child = sessionService.getById(run.getAgentId());
        if (child != null) {
            var artifact = resultStore.saveResult(child.getTranscriptUri(), child.getId(), run.getChildTurnId() == null ? run.getRunId() : run.getChildTurnId(), run.getRunId(), run.getRunId(), "subagent_result",
                    terminal == SUCCEEDED ? ToolCallEndedPayload.ToolCallStatus.COMPLETED : ToolCallEndedPayload.ToolCallStatus.FAILED, StrUtil.nullToEmpty(run.getFinalText()), "子 Agent 完整结果");
            run.setResultId(artifact.getResultId());
        }
        run.setFinishedAt(DateTimeUtil.now());
        change(run, terminal);
        active.remove(run.getRunId());
        notifyAll();
    }

    private void change(SubagentRun run, SubagentRun.Status status) {
        if (run.terminal()) return;
        if (run.getStatus() == CANCELLING && status != CANCELLED && status != CANCELLING) return;
        if (run.getStatus() == status) return;
        SubagentRun next = JSON.parseObject(JSON.toJSONString(run), SubagentRun.class);
        next.setStatus(status);
        next.setVersion(run.getVersion() + 1);
        next.setUpdatedAt(DateTimeUtil.now());
        if (!store.updateById(next)) throw new IllegalStateException("子执行状态持久化失败");
        run.setStatus(status);
        run.setVersion(next.getVersion());
        run.setUpdatedAt(next.getUpdatedAt());
        publish(run);
    }

    private void publish(SubagentRun run) {
        try {
            SubagentRun copy = JSON.parseObject(JSON.toJSONString(run), SubagentRun.class);
            if (copy.getFinalText() != null && copy.getFinalText().length() > 16_000) copy.setFinalText(copy.getFinalText().substring(0, 16_000));
            var parent = sessionService.getSession(run.getParentSessionId());
            SessionEvent event = eventStore.appendSession(parent.getTranscriptUri(), parent.getId(), run.getParentTurnId(), SessionEventType.SUBAGENT_RUN_UPDATED, SessionEventSource.SYSTEM, new SubagentRunUpdatedPayload(run.getParentMessageId(), copy));
            var execution = registry.get(parent.getId());
            if (execution != null && execution.turn.turnId().equals(run.getParentTurnId())) execution.emit(event);
        } catch (RuntimeException ignored) { /* SQLite 是恢复依据，事件写入失败绝不重派任务。 */ }
    }

    private void emit(SubagentRun run, SessionEventType type, SessionEventPayload payload) {
        var parent = registry.get(run.getParentSessionId());
        if (parent == null || !parent.turn.turnId().equals(run.getParentTurnId())) return;
        parent.emit(SessionEvent.builder().eventId(IdUtil.getSnowflakeNextIdStr()).sessionId(run.getParentSessionId()).turnId(run.getParentTurnId()).createdAt(DateTimeUtil.now()).source(SessionEventSource.SYSTEM).type(type).payload(payload).meta(Map.of()).build());
    }

    private SubagentRun managed(String runId, String parentSessionId) {
        if (StrUtil.isBlank(runId)) throw new SubagentException("INVALID_ARGUMENT", "runId 不能为空");
        SubagentRun run = active.get(runId);
        if (run == null) run = store.getById(runId);
        if (run == null) throw new SubagentException("AGENT_NOT_FOUND", "子执行不存在");
        if (!parentSessionId.equals(run.getParentSessionId())) throw new SubagentException("AGENT_ACCESS_DENIED", "无权管理该子执行");
        return run;
    }

    private AgentExecutionRegistry.Execution caller() {
        var invocation = ToolInvocationContext.current();
        if (invocation == null) throw new SubagentException("AGENT_ACCESS_DENIED", "子 Agent 管理工具只能从活动父工具调用发起");
        var execution = registry.require(invocation.sessionId());
        if (execution.child() || !execution.turn.turnId().equals(invocation.turnId())) throw new SubagentException("AGENT_ACCESS_DENIED", "不允许嵌套或失效的子执行委派");
        return execution;
    }
}
