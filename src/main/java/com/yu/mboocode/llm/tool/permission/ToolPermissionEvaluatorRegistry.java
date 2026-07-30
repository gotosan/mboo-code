package com.yu.mboocode.llm.tool.permission;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ToolPermissionEvaluatorRegistry {
    private final List<ToolPermissionEvaluator> evaluators;

    public ToolPermissionEvaluatorRegistry(List<ToolPermissionEvaluator> evaluators) {
        this.evaluators = List.copyOf(evaluators);
    }

    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        return evaluators.stream()
                .filter(evaluator -> evaluator.supports(spec))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("工具权限类型没有评估器: " + spec.permissionType()))
                .evaluate(sessionId, request, spec);
    }
}
