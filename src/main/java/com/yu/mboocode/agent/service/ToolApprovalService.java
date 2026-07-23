package com.yu.mboocode.agent.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.enums.SessionEventSource;
import com.yu.mboocode.agent.enums.SessionEventType;
import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import com.yu.mboocode.agent.model.PendingApproval;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.model.payload.ToolApprovalRequiredPayload;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.tool.permission.FilePermissionUtil;
import com.yu.mboocode.llm.tool.permission.PermissionCheck;
import com.yu.mboocode.llm.tool.permission.SessionPermissions;
import com.yu.mboocode.llm.tool.permission.ToolAuthorizationResult;
import com.yu.mboocode.llm.tool.permission.ToolPermissionErrorCode;
import com.yu.mboocode.llm.tool.permission.ToolPermissionRegistry;
import com.yu.mboocode.llm.tool.permission.ToolPermissionSpec;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Consumer;

/**
 * 工具调用授权服务：判断是否需要用户授权、等待决策、落盘会话级授权，并在取消/清理时收尾。
 */
@Service
public class ToolApprovalService {
    private static final long APPROVAL_TIMEOUT_MINUTES = 10;

    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SessionService sessionService;
    @Resource
    private ToolPermissionRegistry toolPermissionRegistry;

    /** 按 approvalId 索引的待处理授权。 */
    private final Map<String, PendingApproval> pendingByApprovalId = new ConcurrentHashMap<>();
    /** 按 sessionId:toolCallId 索引的待处理授权，用于阻塞等待与去重。 */
    private final Map<String, PendingApproval> pendingByToolCall = new ConcurrentHashMap<>();

    /**
     * 工具执行前检查权限：不足时登记待授权、发出 TOOL_APPROVAL_REQUIRED 事件并返回 true；
     * 已满足权限或评估失败时返回 false（错误交由 awaitAuthorization 返回明确错误码）。
     */
    public boolean requestIfNeeded(SessionTurn sessionTurn, String messageId, ToolExecutionRequest request, Consumer<SessionEvent> eventEmitter, Runnable toolStartedEmitter) {
        ToolPermissionSpec spec = toolPermissionRegistry.get(request.name());
        PermissionCheck check = evaluate(sessionTurn.sessionId(), request, spec);
        if (check.status() == PermissionCheck.CheckStatus.ALLOWED || check.status() == PermissionCheck.CheckStatus.ERROR) {
            return false;
        }

        String approvalId = IdUtil.getSnowflakeNextIdStr();
        PendingApproval pending = new PendingApproval(
                approvalId,
                sessionTurn.sessionId(),
                sessionTurn.turnId(),
                request.name(),
                spec.permissionType(),
                check.grantPath(),
                new CompletableFuture<>(),
                toolStartedEmitter
        );
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
                        .title(buildTitle(spec, check.grantPath()))
                        .description(buildDescription(spec, check.grantPath()))
                        .permissionType(spec.permissionType())
                        .grantPath(check.grantPath())
                        .build()
        );
        eventEmitter.accept(event);
        return true;
    }

    /**
     * 阻塞等待用户对该工具调用的授权结果；会话已授权则立即放行。
     * 超时、拒绝、中断等分别返回不同错误码，并在 finally 中清理待处理记录。
     */
    public ToolAuthorizationResult awaitAuthorization(String sessionId, ToolExecutionRequest request) {
        ToolPermissionSpec spec = toolPermissionRegistry.get(request.name());
        PermissionCheck check = evaluate(sessionId, request, spec);
        if (check.status() == PermissionCheck.CheckStatus.ALLOWED) {
            return ToolAuthorizationResult.allow(ToolApprovalDecision.ALLOW_SESSION, spec.permissionType(), check.grantPath());
        }
        if (check.status() == PermissionCheck.CheckStatus.ERROR) {
            return ToolAuthorizationResult.error(check.errorCode(), check.message(), spec.permissionType(), check.grantPath());
        }

        String toolCallKey = toolCallKey(sessionId, request.id());
        PendingApproval pending = pendingByToolCall.get(toolCallKey);
        if (pending == null) {
            return ToolAuthorizationResult.denied(spec.permissionType(), check.grantPath());
        }

        try {
            ToolApprovalDecision decision = pending.future().get(APPROVAL_TIMEOUT_MINUTES, TimeUnit.MINUTES);
            if (decision == ToolApprovalDecision.DENY) {
                return ToolAuthorizationResult.denied(pending.permissionType(), pending.grantPath());
            }

            // 同意
            pending.toolStartedEmitter().run();
            return ToolAuthorizationResult.allow(decision, pending.permissionType(), pending.grantPath());
        } catch (TimeoutException e) {
            return ToolAuthorizationResult.timeout(pending.permissionType(), pending.grantPath());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_INTERRUPTED, "工具授权等待被中断", pending.permissionType(), pending.grantPath());
        } catch (Exception e) {
            return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_ERROR, "工具授权处理失败", pending.permissionType(), pending.grantPath());
        } finally {
            pendingByApprovalId.remove(pending.approvalId(), pending);
            pendingByToolCall.remove(toolCallKey, pending);
        }
    }

    /**
     * 正式执行工具前再次校验路径与授权状态，降低“检查后参数被替换”的风险。
     * ALLOW_ONCE 不依赖持久化授权，只校验本次授权目录与当前参数解析结果一致。
     */
    public ToolAuthorizationResult verifyBeforeExecute(String sessionId, ToolExecutionRequest request, ToolAuthorizationResult prior) {
        if (prior == null || !prior.allowed()) {
            return prior == null ? ToolAuthorizationResult.denied(null, null) : prior;
        }

        ToolPermissionSpec spec = toolPermissionRegistry.get(request.name());
        if (spec.permissionType() == ToolPermissionType.NONE || spec.permissionType() == ToolPermissionType.TOOL) {
            return prior;
        }

        PermissionCheck check = evaluate(sessionId, request, spec);
        if (check.status() == PermissionCheck.CheckStatus.ERROR) {
            return ToolAuthorizationResult.error(check.errorCode(), check.message(), spec.permissionType(), check.grantPath());
        }

        if (prior.decision() == ToolApprovalDecision.ALLOW_ONCE) {
            if (StrUtil.isBlank(prior.grantPath()) || !StrUtil.equals(prior.grantPath(), check.grantPath())) {
                return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_PATH_CHANGED, "授权路径与当前工具参数不一致", spec.permissionType(), check.grantPath());
            }
            return prior;
        }

        if (check.status() == PermissionCheck.CheckStatus.ALLOWED) {
            return prior;
        }
        return ToolAuthorizationResult.error(ToolPermissionErrorCode.PERMISSION_REVOKED, "会话权限已不满足当前路径", spec.permissionType(), check.grantPath());
    }

    /**
     * 处理用户对指定授权卡片的决策；ALLOW_SESSION 时先落盘会话权限，再完成等待中的 Future。
     */
    public void resolve(String sessionId, String approvalId, ToolApprovalDecision decision) {
        PendingApproval pending = pendingByApprovalId.get(approvalId);
        if (pending == null || !pending.sessionId().equals(sessionId)) {
            throw new ServiceException("工具授权请求不存在或已失效");
        }
        if (decision == ToolApprovalDecision.ALLOW_SESSION) {
            persistSessionGrant(sessionId, pending);
        }
        if (!pending.future().complete(decision)) {
            throw new ServiceException("工具授权请求已处理");
        }
    }

    /**
     * 取消指定 turn 下仍在等待的授权请求，统一按拒绝完成，避免阻塞线程悬挂。
     */
    public void cancelTurn(String sessionId, String turnId) {
        pendingByApprovalId.values().stream()
                .filter(pending -> pending.sessionId().equals(sessionId) && pending.turnId().equals(turnId))
                .forEach(pending -> pending.future().complete(ToolApprovalDecision.DENY));
    }

    /**
     * 清理会话维度的待授权请求（如删除会话时），统一按拒绝完成。
     */
    public void clearSession(String sessionId) {
        pendingByApprovalId.values().stream()
                .filter(pending -> pending.sessionId().equals(sessionId))
                .forEach(pending -> pending.future().complete(ToolApprovalDecision.DENY));
    }

    /**
     * 将会话级授权写入会话权限配置（工具名 / 读路径 / 写路径）。
     */
    private void persistSessionGrant(String sessionId, PendingApproval pending) {
        ToolPermissionType type = pending.permissionType();
        if (type == ToolPermissionType.TOOL) {
            sessionService.grantToolPermission(sessionId, pending.toolName());
            return;
        }
        if (type == ToolPermissionType.READ) {
            sessionService.grantReadPath(sessionId, pending.grantPath());
            return;
        }
        if (type == ToolPermissionType.WRITE) {
            sessionService.grantWritePath(sessionId, pending.grantPath());
        }
    }

    /**
     * 根据工具权限规格与当前会话授权，评估本次调用是否放行、需弹窗或评估失败。
     */
    private PermissionCheck evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        ToolPermissionType type = spec.permissionType();
        if (type == ToolPermissionType.NONE) {
            return PermissionCheck.allowed();
        }

        Sessions session = sessionService.getSession(sessionId);
        SessionPermissions permissions = sessionService.getSessionPermissions(session);

        if (type == ToolPermissionType.TOOL) {
            if (permissions.getAllowedTools() != null && permissions.getAllowedTools().contains(request.name())) {
                return PermissionCheck.allowed();
            }
            return PermissionCheck.needAsk();
        }

        if (type == ToolPermissionType.READ || type == ToolPermissionType.WRITE) {
            // 工具调用的参数路径
            String rawPath;
            try {
                rawPath = extractPathArgument(request.arguments(), spec.pathParam());
            } catch (ServiceException e) {
                return PermissionCheck.error(ToolPermissionErrorCode.PERMISSION_INVALID_PATH, e.getMessage());
            }

            // 实际需要授权的路径
            Path grantDir;
            try {
                grantDir = FilePermissionUtil.resolveGrantDirectory(session.getWorkspacePath(), rawPath, spec.pathKind());
            } catch (ServiceException e) {
                return PermissionCheck.error(ToolPermissionErrorCode.PERMISSION_INVALID_PATH, e.getMessage());
            }

            String grantPath = FilePermissionUtil.toStoredPath(grantDir);
            if (isPathAuthorized(type, grantDir, session.getWorkspacePath(), permissions)) {
                return PermissionCheck.allowed(grantPath);
            }
            return PermissionCheck.needAsk(grantPath);
        }

        return PermissionCheck.error(ToolPermissionErrorCode.PERMISSION_UNKNOWN_TYPE, "未知的工具权限类型");
    }

    /**
     * 判断授权目录是否已被工作区或会话路径授权覆盖。
     * WRITE 授权可覆盖同目录 READ；WRITE 即使在工作区内也必须有明确写授权。
     */
    private boolean isPathAuthorized(ToolPermissionType type, Path grantDir, String workspacePath, SessionPermissions permissions) {
        if (type == ToolPermissionType.READ) {
            if (StrUtil.isNotBlank(workspacePath) && FilePermissionUtil.isUnder(grantDir, Path.of(workspacePath))) {
                return true;
            }
            return FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadPaths())
                    || FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadWritePaths());
        }
        if (type == ToolPermissionType.WRITE) {
            return FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadWritePaths());
        }
        return false;
    }

    /**
     * 从工具参数 JSON 中解析路径字段，缺参或非法 JSON 时抛出业务异常。
     */
    private String extractPathArgument(String argumentsJson, String pathParam) {
        if (StrUtil.isBlank(pathParam)) {
            throw new ServiceException("路径参数未配置");
        }
        if (StrUtil.isBlank(argumentsJson)) {
            throw new ServiceException("缺少路径参数: " + pathParam);
        }
        try {
            JSONObject json = JSON.parseObject(argumentsJson);
            if (json == null || !json.containsKey(pathParam)) {
                throw new ServiceException("缺少路径参数: " + pathParam);
            }
            Object value = json.get(pathParam);
            if (value == null || StrUtil.isBlank(String.valueOf(value))) {
                throw new ServiceException("路径参数不能为空: " + pathParam);
            }
            return String.valueOf(value).trim();
        } catch (ServiceException e) {
            throw e;
        } catch (Exception e) {
            throw new ServiceException("无法解析路径参数: " + pathParam);
        }
    }

    /**
     * 生成授权卡片标题；规格未配置时按权限类型给出默认文案。
     */
    private String buildTitle(ToolPermissionSpec spec, String grantPath) {
        if (StrUtil.isNotBlank(spec.title())) {
            return spec.title();
        }
        return switch (spec.permissionType()) {
            case TOOL -> "允许调用工具 " + spec.toolName() + "？";
            case READ -> "允许读取目录？";
            case WRITE -> "允许写入目录？";
            case NONE -> "需要授权";
        };
    }

    /**
     * 生成授权卡片描述；路径类权限会附带待授权目录说明。
     */
    private String buildDescription(ToolPermissionSpec spec, String grantPath) {
        if (StrUtil.isNotBlank(spec.description()) && spec.permissionType() == ToolPermissionType.TOOL) {
            return spec.description();
        }
        if (spec.permissionType() == ToolPermissionType.READ) {
            return "将授权读取目录：" + grantPath + "（包含其子目录）";
        }
        if (spec.permissionType() == ToolPermissionType.WRITE) {
            return "将授权读写目录：" + grantPath + "（包含其子目录）";
        }
        if (StrUtil.isNotBlank(spec.description())) {
            return spec.description();
        }
        return "工具 " + spec.toolName() + " 需要授权后才能继续。";
    }

    /**
     * 组装 sessionId + toolCallId 的待授权索引键。
     */
    private String toolCallKey(String sessionId, String toolCallId) {
        if (StrUtil.isBlank(toolCallId)) {
            throw new ServiceException("工具调用 ID 不能为空");
        }
        return sessionId + ":" + toolCallId;
    }
}

