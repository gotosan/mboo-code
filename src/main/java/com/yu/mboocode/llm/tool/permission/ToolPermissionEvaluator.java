package com.yu.mboocode.llm.tool.permission;

import dev.langchain4j.agent.tool.ToolExecutionRequest;

public interface ToolPermissionEvaluator {
    boolean supports(ToolPermissionSpec spec);

    ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec);
}
