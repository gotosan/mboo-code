package com.yu.mboocode.agent.tool.permission;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ToolPermissionEvaluatorRegistry {
    @Resource
    private List<ToolPermissionEvaluator> evaluators;

    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        return evaluators.stream()
                .filter(evaluator -> evaluator.supports(spec))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("工具权限类型没有评估器: " + spec.permissionType()))
                .evaluate(sessionId, request, spec);
    }
}
