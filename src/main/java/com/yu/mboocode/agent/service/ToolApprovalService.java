package com.yu.mboocode.agent.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.agent.enums.SessionEventSource;
import com.yu.mboocode.agent.enums.SessionEventType;
import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import com.yu.mboocode.agent.model.PendingApproval;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.payload.ToolApprovalRequiredPayload;
import com.yu.mboocode.common.exception.ServiceException;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

@Service
public class ToolApprovalService {
    private static final long APPROVAL_TIMEOUT_MINUTES = 10;
    private static final Set<String> APPROVAL_REQUIRED_TOOLS = Set.of("getWeather");

    @Resource
    private SessionEventStore sessionEventStore;

    private final Map<String, PendingApproval> pendingByApprovalId = new ConcurrentHashMap<>();
    private final Map<String, PendingApproval> pendingByToolCall = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> sessionAllowedTools = new ConcurrentHashMap<>();

    public boolean requestIfNeeded(SessionTurn sessionTurn, String messageId, ToolExecutionRequest request, Consumer<SessionEvent> eventEmitter, Runnable toolStartedEmitter) {
        if (!APPROVAL_REQUIRED_TOOLS.contains(request.name()) || isSessionAllowed(sessionTurn.sessionId(), request.name())) {
            return false;
        }

        String approvalId = IdUtil.fastSimpleUUID();
        PendingApproval pending = new PendingApproval(approvalId, sessionTurn.sessionId(), sessionTurn.turnId(), request.name(), new CompletableFuture<>(), toolStartedEmitter);
        String toolCallKey = toolCallKey(sessionTurn.sessionId(), request.id());
        PendingApproval existing = pendingByToolCall.putIfAbsent(toolCallKey, pending);
        if (existing != null) {
            return true;
        }
        pendingByApprovalId.put(approvalId, pending);

        SessionEvent event = sessionEventStore.appendSession(
                sessionTurn.transcriptUri(),
                sessionTurn.sessionId(),
                sessionTurn.turnId(),
                SessionEventType.TOOL_APPROVAL_REQUIRED,
                SessionEventSource.SYSTEM,
                ToolApprovalRequiredPayload.builder()
                        .messageId(messageId)
                        .approvalId(approvalId)
                        .toolCallId(request.id())
                        .toolName(request.name())
                        .arguments(request.arguments())
                        .title("允许查询天气？")
                        .description("天气工具将访问网络，根据城市名称查询实时天气。")
                        .build()
        );
        eventEmitter.accept(event);
        return true;
    }

    public ToolApprovalDecision awaitDecision(String sessionId, ToolExecutionRequest request) {
        if (!APPROVAL_REQUIRED_TOOLS.contains(request.name()) || isSessionAllowed(sessionId, request.name())) {
            return ToolApprovalDecision.ALLOW_SESSION;
        }

        String toolCallKey = toolCallKey(sessionId, request.id());
        PendingApproval pending = pendingByToolCall.get(toolCallKey);
        if (pending == null) {
            return ToolApprovalDecision.DENY;
        }

        try {
            ToolApprovalDecision decision = pending.future().get(APPROVAL_TIMEOUT_MINUTES, TimeUnit.MINUTES);
            if (decision != ToolApprovalDecision.DENY) {
                pending.toolStartedEmitter().run();
            }
            return decision;
        } catch (TimeoutException e) {
            return ToolApprovalDecision.DENY;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ToolApprovalDecision.DENY;
        } catch (Exception e) {
            return ToolApprovalDecision.DENY;
        } finally {
            pendingByApprovalId.remove(pending.approvalId(), pending);
            pendingByToolCall.remove(toolCallKey, pending);
        }
    }

    public void resolve(String sessionId, String approvalId, ToolApprovalDecision decision) {
        PendingApproval pending = pendingByApprovalId.get(approvalId);
        if (pending == null || !pending.sessionId().equals(sessionId)) {
            throw new ServiceException("工具授权请求不存在或已失效");
        }
        if (decision == ToolApprovalDecision.ALLOW_SESSION) {
            sessionAllowedTools.computeIfAbsent(sessionId, key -> ConcurrentHashMap.newKeySet()).add(pending.toolName());
        }
        if (!pending.future().complete(decision)) {
            throw new ServiceException("工具授权请求已处理");
        }
    }

    public void cancelTurn(String sessionId, String turnId) {
        pendingByApprovalId.values().stream()
                .filter(pending -> pending.sessionId().equals(sessionId) && pending.turnId().equals(turnId))
                .forEach(pending -> pending.future().complete(ToolApprovalDecision.DENY));
    }

    public void clearSession(String sessionId) {
        sessionAllowedTools.remove(sessionId);
        pendingByApprovalId.values().stream()
                .filter(pending -> pending.sessionId().equals(sessionId))
                .forEach(pending -> pending.future().complete(ToolApprovalDecision.DENY));
    }

    private boolean isSessionAllowed(String sessionId, String toolName) {
        return sessionAllowedTools.getOrDefault(sessionId, Collections.emptySet()).contains(toolName);
    }

    private String toolCallKey(String sessionId, String toolCallId) {
        if (StrUtil.isBlank(toolCallId)) {
            throw new ServiceException("工具调用 ID 不能为空");
        }
        return sessionId + ":" + toolCallId;
    }
}
