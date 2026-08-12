package com.yu.mboocode.agent.tool;

import dev.langchain4j.agent.tool.ToolExecutionRequest;

public interface ToolRequestValidator {
    boolean supports(String toolName);

    void validate(String sessionId, ToolExecutionRequest request);
}
