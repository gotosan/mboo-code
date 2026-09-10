package com.yu.mboocode.agent.subagent;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.invocation.InvocationContext;
import dev.langchain4j.service.tool.*;
import com.yu.mboocode.agent.tool.ToolException;

/** 静态、MCP、Skill 共用执行入口；目录过滤以外再次校验真实运行时能力。 */
public class RoleToolExecutor implements ToolExecutor {
    private final ToolExecutor delegate;
    private final AgentExecutionRegistry registry;
    public RoleToolExecutor(ToolExecutor delegate, AgentExecutionRegistry registry) { this.delegate = delegate; this.registry = registry; }
    @Override
    public String execute(ToolExecutionRequest request, Object memoryId) { return executeWithContext(request, InvocationContext.builder().chatMemoryId(memoryId).build()).resultText(); }
    @Override
    public ToolExecutionResult executeWithContext(ToolExecutionRequest request, InvocationContext context) {
        String sessionId = String.valueOf(context.chatMemoryId());
        AgentExecutionRegistry.Execution execution = null;
        try {
            registry.checkTool(sessionId, request.name());
            execution = registry.require(sessionId);
            execution.activeTools.incrementAndGet();
            registry.checkTool(sessionId, request.name());
            return delegate.executeWithContext(request, context);
        } catch (ToolException e) {
            return ToolExecutionResult.builder().isError(true).resultText(e.toResultJson()).build();
        } finally {
            if (execution != null) execution.activeTools.decrementAndGet();
        }
    }
}
