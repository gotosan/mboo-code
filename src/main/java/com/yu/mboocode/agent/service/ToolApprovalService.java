package com.yu.mboocode.agent.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.agent.enums.SessionEventSource;
import com.yu.mboocode.agent.enums.SessionEventType;
import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import com.yu.mboocode.agent.model.PendingApproval;
import com.yu.mboocode.agent.model.PendingToolAuthorization;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.payload.ToolApprovalRequiredPayload;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.tool.ToolException;
import com.yu.mboocode.llm.tool.ToolRequestValidatorRegistry;
import com.yu.mboocode.llm.tool.event.ToolEventFormatterRegistry;
import com.yu.mboocode.llm.tool.command.RunningCommandRegistry;
import com.yu.mboocode.llm.tool.permission.PermissionCheck;
import com.yu.mboocode.llm.tool.permission.PermissionRequirement;
import com.yu.mboocode.llm.tool.permission.ToolAuthorizationResult;
import com.yu.mboocode.llm.tool.permission.ToolPermissionChain;
import com.yu.mboocode.llm.tool.permission.ToolPermissionErrorCode;
import com.yu.mboocode.llm.tool.permission.ToolPermissionEvaluatorRegistry;
import com.yu.mboocode.llm.tool.permission.ToolPermissionRegistry;
import com.yu.mboocode.llm.tool.permission.ToolPermissionSpec;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * 工具权限链服务。一次调用只暴露当前阶段，全部要求满足并复核后才允许真实工具启动。
 */
@Service
public class ToolApprovalService {
    private static final long APPROVAL_TIMEOUT_MINUTES = 10;

    private final SessionEventStore sessionEventStore;
    private final SessionService sessionService;
    private final ToolPermissionRegistry toolPermissionRegistry;
    private final ToolPermissionEvaluatorRegistry evaluatorRegistry;
    private final ToolRequestValidatorRegistry validatorRegistry;
    private final ToolEventFormatterRegistry toolEventFormatterRegistry;
    private final RunningCommandRegistry runningCommandRegistry;
    private final Map<String, PendingApproval> pendingByApprovalId = new ConcurrentHashMap<>();
    private final Map<String, PendingToolAuthorization> pendingByToolCall = new ConcurrentHashMap<>();
    private final Map<String, String> invocationTurnIds = new ConcurrentHashMap<>();

    public ToolApprovalService(SessionEventStore sessionEventStore, SessionService sessionService, ToolPermissionRegistry toolPermissionRegistry,
                               ToolPermissionEvaluatorRegistry evaluatorRegistry, ToolRequestValidatorRegistry validatorRegistry,
                               ToolEventFormatterRegistry toolEventFormatterRegistry, RunningCommandRegistry runningCommandRegistry) {
        this.sessionEventStore = sessionEventStore;
        this.sessionService = sessionService;
        this.toolPermissionRegistry = toolPermissionRegistry;
        this.evaluatorRegistry = evaluatorRegistry;
        this.validatorRegistry = validatorRegistry;
        this.toolEventFormatterRegistry = toolEventFormatterRegistry;
        this.runningCommandRegistry = runningCommandRegistry;
    }

    public ApprovalRequestStatus requestIfNeeded(SessionTurn sessionTurn, String messageId, ToolExecutionRequest request,
                                                  Consumer<SessionEvent> eventEmitter, Runnable toolStartedEmitter) {
        String key = toolCallKey(sessionTurn.sessionId(), request.id());
        invocationTurnIds.put(key, sessionTurn.turnId());
        ToolPermissionChain chain;
        try {
            validatorRegistry.validate(sessionTurn.sessionId(), request);
            chain = evaluate(sessionTurn.sessionId(), request);
        } catch (ToolException | ServiceException e) {
            return ApprovalRequestStatus.INVALID;
        }
        if (chain.hasError()) return ApprovalRequestStatus.INVALID;
        if (!chain.needsApproval()) return ApprovalRequestStatus.ALLOWED;

        PendingToolAuthorization authorization = new PendingToolAuthorization(sessionTurn.sessionId(), sessionTurn.turnId(), sessionTurn.transcriptUri(), messageId, request, chain, eventEmitter, toolStartedEmitter);
        PendingToolAuthorization existing = pendingByToolCall.putIfAbsent(key, authorization);
        if (existing != null) return ApprovalRequestStatus.WAITING;
        int firstIndex = firstApprovalIndex(chain, 0);
        createApproval(authorization, firstIndex);
        return ApprovalRequestStatus.WAITING;
    }

    public ToolAuthorizationResult awaitAuthorization(String sessionId, ToolExecutionRequest request) {
        String key = toolCallKey(sessionId, request.id());
        PendingToolAuthorization authorization = pendingByToolCall.get(key);
        if (authorization == null) return evaluateImmediate(sessionId, request);

        PermissionRequirement lastRequirement = null;
        try {
            for (int index = 0; index < authorization.chain().requirements().size(); index++) {
                PermissionRequirement requirement = authorization.chain().requirements().get(index);
                lastRequirement = requirement;
                if (requirement.check().status() == PermissionCheck.CheckStatus.ALLOWED) continue;
                if (requirement.check().status() == PermissionCheck.CheckStatus.ERROR) return error(requirement);

                PendingApproval pending = authorization.currentApproval();
                if (pending == null || pending.requirementIndex() != index) pending = createApproval(authorization, index);
                ToolApprovalDecision decision = pending.future().get(APPROVAL_TIMEOUT_MINUTES, TimeUnit.MINUTES);
                cleanupApproval(pending);
                if (decision == ToolApprovalDecision.DENY || authorization.cancelled()) {
                    return ToolAuthorizationResult.denied(requirement.permissionType(), requirement.grantPath());
                }
                authorization.grantedRequirements().add(requirement);
                int nextIndex = firstApprovalIndex(authorization.chain(), index + 1);
                if (nextIndex >= 0) createApproval(authorization, nextIndex);
            }

            ToolAuthorizationResult verified = verifyFinalPlan(sessionId, request, authorization);
            if (!verified.allowed()) return verified;
            authorization.toolStartedEmitter().run();
            return ToolAuthorizationResult.allow(ToolApprovalDecision.ALLOW_ONCE,
                    lastRequirement == null ? ToolPermissionType.NONE : lastRequirement.permissionType(),
                    lastRequirement == null ? null : lastRequirement.grantPath());
        } catch (TimeoutException e) {
            PendingApproval pending = authorization.currentApproval();
            return ToolAuthorizationResult.timeout(pending == null ? null : pending.permissionType(), pending == null ? null : pending.grantPath());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            PendingApproval pending = authorization.currentApproval();
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_INTERRUPTED, "工具授权等待被中断",
                    pending == null ? null : pending.permissionType(), pending == null ? null : pending.grantPath());
        } catch (Exception e) {
            PendingApproval pending = authorization.currentApproval();
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_ERROR, "工具授权处理失败",
                    pending == null ? null : pending.permissionType(), pending == null ? null : pending.grantPath());
        } finally {
            PendingApproval pending = authorization.currentApproval();
            if (pending != null) cleanupApproval(pending);
            pendingByToolCall.remove(key, authorization);
        }
    }

    public void resolve(String sessionId, String approvalId, ToolApprovalDecision decision) {
        PendingApproval pending = pendingByApprovalId.get(approvalId);
        if (pending == null || !pending.sessionId().equals(sessionId)) throw new ServiceException("工具授权请求不存在或已失效");
        if (decision == ToolApprovalDecision.ALLOW_SESSION) persistSessionGrant(sessionId, pending);
        if (!pending.future().complete(decision)) throw new ServiceException("工具授权请求已处理");
    }

    public void cancelTurn(String sessionId, String turnId) {
        runningCommandRegistry.cancelTurn(sessionId, turnId);
        pendingByToolCall.values().stream()
                .filter(item -> item.sessionId().equals(sessionId) && item.turnId().equals(turnId))
                .forEach(item -> {
                    item.cancel();
                    PendingApproval pending = item.currentApproval();
                    if (pending != null) pending.future().complete(ToolApprovalDecision.DENY);
                });
    }

    public void clearSession(String sessionId) {
        runningCommandRegistry.clearSession(sessionId);
        pendingByToolCall.values().stream()
                .filter(item -> item.sessionId().equals(sessionId))
                .forEach(item -> {
                    item.cancel();
                    PendingApproval pending = item.currentApproval();
                    if (pending != null) pending.future().complete(ToolApprovalDecision.DENY);
                });
    }

    public String turnId(String sessionId, String toolCallId) {
        return invocationTurnIds.get(toolCallKey(sessionId, toolCallId));
    }

    public void completeInvocation(String sessionId, String toolCallId) {
        invocationTurnIds.remove(toolCallKey(sessionId, toolCallId));
    }

    private ToolAuthorizationResult evaluateImmediate(String sessionId, ToolExecutionRequest request) {
        try {
            ToolPermissionChain chain = evaluate(sessionId, request);
            for (PermissionRequirement requirement : chain.requirements()) {
                if (requirement.check().status() == PermissionCheck.CheckStatus.ERROR) return error(requirement);
                if (requirement.check().status() == PermissionCheck.CheckStatus.NEED_ASK) return ToolAuthorizationResult.denied(requirement.permissionType(), requirement.grantPath());
            }
            PermissionRequirement last = chain.requirements().isEmpty() ? null : chain.requirements().getLast();
            return ToolAuthorizationResult.allow(ToolApprovalDecision.ALLOW_SESSION, last == null ? ToolPermissionType.NONE : last.permissionType(), last == null ? null : last.grantPath());
        } catch (ToolException e) {
            throw e;
        } catch (RuntimeException e) {
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_ERROR, "工具权限评估失败", null, null);
        }
    }

    private ToolAuthorizationResult verifyFinalPlan(String sessionId, ToolExecutionRequest request, PendingToolAuthorization authorization) {
        ToolPermissionChain current;
        try {
            current = evaluate(sessionId, request);
        } catch (RuntimeException e) {
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_REVOKED, "执行前权限复核失败", null, null);
        }
        for (PermissionRequirement requirement : current.requirements()) {
            if (requirement.check().status() == PermissionCheck.CheckStatus.ERROR) return error(requirement);
            if (requirement.check().status() == PermissionCheck.CheckStatus.ALLOWED) continue;
            boolean onceGranted = authorization.grantedRequirements().stream().anyMatch(granted -> granted.sameScope(requirement));
            if (!onceGranted) {
                ToolPermissionErrorCode code = requirement.permissionType() == ToolPermissionType.COMMAND
                        ? ToolPermissionErrorCode.COMMAND_PERMISSION_CHANGED : ToolPermissionErrorCode.PERMISSION_PATH_CHANGED;
                return ToolAuthorizationResult.error(code, "执行前权限范围与授权时不一致", requirement.permissionType(), requirement.grantPath());
            }
        }
        return ToolAuthorizationResult.allow(ToolApprovalDecision.ALLOW_ONCE, null, null);
    }

    private PendingApproval createApproval(PendingToolAuthorization authorization, int index) {
        PermissionRequirement requirement = authorization.chain().requirements().get(index);
        String approvalId = IdUtil.getSnowflakeNextIdStr();
        int approvalIndex = approvalStageIndex(authorization.chain(), index);
        int approvalCount = approvalStageCount(authorization.chain());
        PendingApproval pending = new PendingApproval(approvalId, authorization.sessionId(), authorization.turnId(), authorization.request().name(),
                requirement.permissionType(), requirement.grantPath(), requirement.grantValue(), approvalIndex, approvalCount, index, new CompletableFuture<>());
        authorization.currentApproval(pending);
        pendingByApprovalId.put(approvalId, pending);
        SessionEvent event = sessionEventStore.appendSession(authorization.transcriptUri(),
                authorization.sessionId(), authorization.turnId(), SessionEventType.TOOL_APPROVAL_REQUIRED, SessionEventSource.SYSTEM,
                ToolApprovalRequiredPayload.builder()
                        .messageId(authorization.messageId())
                        .approvalId(approvalId)
                        .toolCallId(authorization.request().id())
                        .toolName(authorization.request().name())
                        .arguments(toolEventFormatterRegistry.formatArguments(authorization.request().name(), authorization.request().arguments()))
                        .title(buildTitle(requirement, authorization.request().name()))
                        .description(buildDescription(requirement, authorization.request().name()))
                        .permissionType(requirement.permissionType())
                        .grantPath(requirement.grantPath())
                        .approvalIndex(approvalIndex)
                        .approvalCount(approvalCount)
                        .build());
        authorization.eventEmitter().accept(event);
        return pending;
    }

    private void cleanupApproval(PendingApproval pending) {
        pendingByApprovalId.remove(pending.approvalId(), pending);
    }

    private int firstApprovalIndex(ToolPermissionChain chain, int start) {
        for (int index = start; index < chain.requirements().size(); index++) {
            if (chain.requirements().get(index).check().status() == PermissionCheck.CheckStatus.NEED_ASK) return index;
        }
        return -1;
    }

    private int approvalStageIndex(ToolPermissionChain chain, int requirementIndex) {
        int approvalIndex = 0;
        for (int index = 0; index <= requirementIndex; index++) {
            if (chain.requirements().get(index).check().status() == PermissionCheck.CheckStatus.NEED_ASK) approvalIndex++;
        }
        return approvalIndex;
    }

    private int approvalStageCount(ToolPermissionChain chain) {
        return (int) chain.requirements().stream()
                .filter(item -> item.check().status() == PermissionCheck.CheckStatus.NEED_ASK)
                .count();
    }

    private ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request) {
        ToolPermissionSpec spec = toolPermissionRegistry.get(request.name());
        return evaluatorRegistry.evaluate(sessionId, request, spec);
    }

    private void persistSessionGrant(String sessionId, PendingApproval pending) {
        switch (pending.permissionType()) {
            case TOOL -> sessionService.grantToolPermission(sessionId, pending.toolName());
            case READ -> sessionService.grantReadPath(sessionId, pending.grantPath());
            case WRITE -> sessionService.grantWritePath(sessionId, pending.grantPath());
            case COMMAND -> sessionService.grantCommandPermission(sessionId, pending.grantValue());
            case NONE -> {
            }
        }
    }

    private ToolAuthorizationResult error(PermissionRequirement requirement) {
        return ToolAuthorizationResult.error(requirement.check().errorCode(), requirement.check().message(), requirement.permissionType(), requirement.grantPath());
    }

    private String buildTitle(PermissionRequirement requirement, String toolName) {
        if (StrUtil.isNotBlank(requirement.title())) return requirement.title();
        return switch (requirement.permissionType()) {
            case TOOL -> "允许调用工具 " + toolName + "？";
            case READ -> "允许读取目录？";
            case WRITE -> "允许写入目录？";
            case COMMAND -> "允许执行命令？";
            case NONE -> "需要授权";
        };
    }

    private String buildDescription(PermissionRequirement requirement, String toolName) {
        if (StrUtil.isNotBlank(requirement.description())) return requirement.description();
        return switch (requirement.permissionType()) {
            case READ -> "将授权读取目录：" + requirement.grantPath() + "（包含其子目录）";
            case WRITE -> "将授权读写目录：" + requirement.grantPath() + "（包含其子目录）";
            default -> "工具 " + toolName + " 需要授权后才能继续。";
        };
    }

    private String toolCallKey(String sessionId, String toolCallId) {
        if (StrUtil.isBlank(toolCallId)) throw new ServiceException("工具调用 ID 不能为空");
        return sessionId + ":" + toolCallId;
    }

    public enum ApprovalRequestStatus {
        ALLOWED,
        WAITING,
        INVALID
    }
}
