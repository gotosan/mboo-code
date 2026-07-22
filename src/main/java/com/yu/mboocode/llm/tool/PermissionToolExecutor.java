package com.yu.mboocode.llm.tool;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import com.yu.mboocode.agent.service.ToolApprovalService;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.invocation.InvocationContext;
import dev.langchain4j.service.tool.DefaultToolExecutor;
import dev.langchain4j.service.tool.ToolExecutionResult;
import dev.langchain4j.service.tool.ToolExecutor;

import java.lang.reflect.Method;
import java.util.Map;

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
        ToolApprovalDecision decision = toolApprovalService.awaitDecision(sessionId, request);
        if (decision == ToolApprovalDecision.DENY) {
            return ToolExecutionResult.builder()
                    .isError(true)
                    .resultText(JSON.toJSONString(Map.of("errorCode", "PERMISSION_DENIED", "message", "用户拒绝了本次工具调用")))
                    .attributes(Map.of("permissionDecision", "denied"))
                    .build();
        }
        return delegate.executeWithContext(request, context);
    }
}
