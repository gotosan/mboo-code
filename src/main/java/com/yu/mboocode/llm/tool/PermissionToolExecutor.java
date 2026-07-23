package com.yu.mboocode.llm.tool;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.service.ToolApprovalService;
import com.yu.mboocode.llm.tool.permission.ToolAuthorizationResult;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.invocation.InvocationContext;
import dev.langchain4j.service.tool.DefaultToolExecutor;
import dev.langchain4j.service.tool.ToolExecutionResult;
import dev.langchain4j.service.tool.ToolExecutor;

import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 在真实工具执行前完成权限等待与执行前复核。
 */
public class PermissionToolExecutor implements ToolExecutor {
    private final ToolExecutor delegate;
    private final ToolApprovalService toolApprovalService;

    public PermissionToolExecutor(Object object, Method method, ToolApprovalService toolApprovalService) {
        this.delegate = new DefaultToolExecutor(object, method);
        this.toolApprovalService = toolApprovalService;
    }

    @Override
    public String execute(ToolExecutionRequest request, Object memoryId) {
        InvocationContext context = InvocationContext.builder().chatMemoryId(memoryId).build();
        return executeWithContext(request, context).resultText();
    }

    @Override
    public ToolExecutionResult executeWithContext(ToolExecutionRequest request, InvocationContext context) {
        String sessionId = String.valueOf(context.chatMemoryId());
        ToolAuthorizationResult authorization = toolApprovalService.awaitAuthorization(sessionId, request);
        if (!authorization.allowed()) {
            return toErrorResult(authorization);
        }

        ToolAuthorizationResult verified = toolApprovalService.verifyBeforeExecute(sessionId, request, authorization);
        if (!verified.allowed()) {
            return toErrorResult(verified);
        }

        return delegate.executeWithContext(request, context);
    }

    private ToolExecutionResult toErrorResult(ToolAuthorizationResult authorization) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("errorCode", authorization.errorCode() == null ? null : authorization.errorCode().getCode());
        body.put("message", authorization.message());
        if (authorization.permissionType() != null) {
            body.put("permissionType", authorization.permissionType().name());
        }
        if (authorization.grantPath() != null) {
            body.put("grantPath", authorization.grantPath());
        }
        return ToolExecutionResult.builder()
                .isError(true)
                .resultText(JSON.toJSONString(body))
                .attributes(Map.of(
                        "permissionDecision", authorization.errorCode() == null ? "denied" : authorization.errorCode().getCode(),
                        "permissionAllowed", false
                ))
                .build();
    }
}