package com.yu.mboocode.agent.tool;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ToolRequestValidatorRegistry {
    @Resource
    private List<ToolRequestValidator> validators;

    public void validate(String sessionId, ToolExecutionRequest request) {
        for (ToolRequestValidator validator : validators) {
            if (validator.supports(request.name())) validator.validate(sessionId, request);
        }
    }
}
