package com.yu.mboocode.llm.tool;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ToolRequestValidatorRegistry {
    private final List<ToolRequestValidator> validators;

    public ToolRequestValidatorRegistry(List<ToolRequestValidator> validators) {
        this.validators = List.copyOf(validators);
    }

    public void validate(String sessionId, ToolExecutionRequest request) {
        for (ToolRequestValidator validator : validators) {
            if (validator.supports(request.name())) validator.validate(sessionId, request);
        }
    }
}
