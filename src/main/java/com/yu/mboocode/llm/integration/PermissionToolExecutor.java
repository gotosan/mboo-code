package com.yu.mboocode.llm.integration;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.ToolApprovalService;
import com.yu.mboocode.agent.tool.ToolException;
import com.yu.mboocode.agent.tool.ToolInvocationContext;
import com.yu.mboocode.agent.tool.ToolRequestValidatorRegistry;
import com.yu.mboocode.agent.tool.permission.ToolAuthorizationResult;
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
    private final ToolRequestValidatorRegistry validatorRegistry;

    public PermissionToolExecutor(Object object, Method method, ToolApprovalService toolApprovalService, ToolRequestValidatorRegistry validatorRegistry) {
        this.delegate = new DefaultToolExecutor(object, method);
        this.toolApprovalService = toolApprovalService;
        this.validatorRegistry = validatorRegistry;
    }

    @Override
    public String execute(ToolExecutionRequest request, Object memoryId) {
        InvocationContext context = InvocationContext.builder().chatMemoryId(memoryId).build();
        return executeWithContext(request, context).resultText();
    }

    @Override
    public ToolExecutionResult executeWithContext(ToolExecutionRequest request, InvocationContext context) {
        String sessionId = String.valueOf(context.chatMemoryId());
        ToolAuthorizationResult authorization;
        try {
            validatorRegistry.validate(sessionId, request);
            authorization = toolApprovalService.awaitAuthorization(sessionId, request);
        } catch (ToolException e) {
            toolApprovalService.completeInvocation(sessionId, request.id());
            return ToolExecutionResult.builder().isError(true).resultText(e.toResultJson()).build();
        }
        if (!authorization.allowed()) {
            toolApprovalService.completeInvocation(sessionId, request.id());
            return toErrorResult(authorization);
        }

        ToolInvocationContext.set(sessionId, toolApprovalService.turnId(sessionId, request.id()), request.id());
        try {
            return delegate.executeWithContext(request, context);
        } finally {
            ToolInvocationContext.clear();
            toolApprovalService.completeInvocation(sessionId, request.id());
        }
    }

    private ToolExecutionResult toErrorResult(ToolAuthorizationResult authorization) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("success", false);
        body.put("status", "FAILED");
        body.put("errorCode", authorization.errorCode() == null ? null : authorization.errorCode().getCode());
        body.put("message", authorization.message());
        body.put("data", null);
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
