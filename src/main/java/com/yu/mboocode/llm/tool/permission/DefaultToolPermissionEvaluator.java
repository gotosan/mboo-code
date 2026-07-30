package com.yu.mboocode.llm.tool.permission;

import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.exception.ServiceException;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.List;

@Component
public class DefaultToolPermissionEvaluator implements ToolPermissionEvaluator {
    private final SessionService sessionService;

    public DefaultToolPermissionEvaluator(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    @Override
    public boolean supports(ToolPermissionSpec spec) {
        return spec.permissionType() != ToolPermissionType.COMMAND;
    }

    @Override
    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        ToolPermissionType type = spec.permissionType();
        if (type == ToolPermissionType.NONE) return new ToolPermissionChain(List.of());
        Sessions session = sessionService.getSession(sessionId);
        SessionPermissions permissions = sessionService.getSessionPermissions(session);
        PermissionCheck check;
        if (type == ToolPermissionType.TOOL) {
            check = permissions.getAllowedTools().contains(request.name()) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
        } else if (type == ToolPermissionType.READ || type == ToolPermissionType.WRITE) {
            check = evaluatePath(request, spec, session, permissions);
        } else {
            check = PermissionCheck.error(ToolPermissionErrorCode.PERMISSION_UNKNOWN_TYPE, "未知的工具权限类型");
        }
        return new ToolPermissionChain(List.of(new PermissionRequirement(type, check.grantPath(), request.name(), spec.title(), spec.description(), check)));
    }

    private PermissionCheck evaluatePath(ToolExecutionRequest request, ToolPermissionSpec spec, Sessions session, SessionPermissions permissions) {
        try {
            JSONObject arguments = JSON.parseObject(request.arguments());
            if (arguments == null || StrUtil.isBlank(arguments.getString(spec.pathParam()))) throw new ServiceException("缺少路径参数: " + spec.pathParam());
            Path grantDir = FilePermissionUtil.resolveGrantDirectory(session.getWorkspacePath(), arguments.getString(spec.pathParam()), spec.pathKind());
            String grantPath = FilePermissionUtil.toStoredPath(grantDir);
            if (isPathAuthorized(spec.permissionType(), grantDir, session.getWorkspacePath(), permissions)) return PermissionCheck.allowed(grantPath);
            return PermissionCheck.needAsk(grantPath);
        } catch (RuntimeException e) {
            return PermissionCheck.error(ToolPermissionErrorCode.PERMISSION_INVALID_PATH, e.getMessage());
        }
    }

    private boolean isPathAuthorized(ToolPermissionType type, Path grantDir, String workspacePath, SessionPermissions permissions) {
        if (type == ToolPermissionType.READ) {
            if (StrUtil.isNotBlank(workspacePath) && FilePermissionUtil.isUnder(grantDir, Path.of(workspacePath))) return true;
            return FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadPaths()) || FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadWritePaths());
        }
        return type == ToolPermissionType.WRITE && FilePermissionUtil.isCoveredByAny(grantDir, permissions.getReadWritePaths());
    }
}
