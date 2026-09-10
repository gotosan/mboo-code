package com.yu.mboocode.agent.subagent;

import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.tool.ToolException;
import com.yu.mboocode.agent.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.prompt.SystemPromptSnapshot;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Component;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/** 异步回调显式解析执行身份，禁止通过 ThreadLocal 继承父权限。 */
@Component
public class AgentExecutionRegistry {
    private final Map<String, Execution> executions = new ConcurrentHashMap<>();

    public Execution register(SessionTurn turn, AgentIdentity identity) {
        Execution execution = new Execution(turn, identity);
        if (executions.putIfAbsent(turn.sessionId(), execution) != null) throw new IllegalStateException("会话执行身份重复");
        return execution;
    }

    public Execution get(String sessionId) { return executions.get(sessionId); }
    public Execution require(String sessionId) {
        Execution execution = get(sessionId);
        if (execution == null || execution.cancelled.get()) throw new IllegalStateException("执行已失效或已取消");
        return execution;
    }
    public void remove(String sessionId, String turnId) {
        executions.computeIfPresent(sessionId, (key, value) -> value.turn.turnId().equals(turnId) ? null : value);
    }
    public boolean allows(String sessionId, String toolName) {
        Execution execution = get(sessionId);
        if (execution == null || execution.cancelled.get()) return false;
        return !execution.child() || AgentDefinition.require(execution.identity.agentRole()).allows(toolName);
    }
    public void checkTool(String sessionId, String toolName) {
        if (!allows(sessionId, toolName)) throw new SubagentException("AGENT_ACCESS_DENIED", "当前执行角色不允许调用工具：" + toolName);
        Execution execution = require(sessionId);
        if (execution.toolNames != null && !execution.toolNames.contains(toolName)) throw new SubagentException("AGENT_ACCESS_DENIED", "工具不在当前执行快照中：" + toolName);
    }

    @Schema(description = "单 turn 的异步执行上下文")
    public static final class Execution {
        public final SessionTurn turn;
        public final AgentIdentity identity;
        public final AtomicBoolean cancelled = new AtomicBoolean();
        public final AtomicInteger activeTools = new AtomicInteger();
        public final AtomicInteger joinCorrections = new AtomicInteger();
        public final AtomicInteger toolRounds = new AtomicInteger();
        public final AtomicInteger requestSequence = new AtomicInteger();
        public volatile ChatRequestParameters parameters;
        public volatile SystemPromptSnapshot prompt;
        public volatile String messageId;
        public volatile Set<String> toolNames;
        public volatile Consumer<SessionEvent> emitter;
        public volatile Runnable checkpoint;
        public volatile String runId;
        public volatile Long inputTokens;
        public volatile Long outputTokens;
        public volatile Long totalTokens;
        private Execution(SessionTurn turn, AgentIdentity identity) { this.turn = turn; this.identity = identity; }
        public boolean child() { return identity != null && "subagent".equals(identity.sessionKind()); }
        public String permissionOwner() { return child() ? identity.parentSessionId() : turn.sessionId(); }
        public void emit(SessionEvent event) { if (emitter != null) emitter.accept(event); }
    }
}
