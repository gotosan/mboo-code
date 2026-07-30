package com.yu.mboocode.agent.model;

import com.yu.mboocode.llm.tool.permission.PermissionRequirement;
import com.yu.mboocode.llm.tool.permission.ToolPermissionChain;
import dev.langchain4j.agent.tool.ToolExecutionRequest;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public class PendingToolAuthorization {
    private final String sessionId;
    private final String turnId;
    private final String transcriptUri;
    private final String messageId;
    private final ToolExecutionRequest request;
    private final ToolPermissionChain chain;
    private final Consumer<SessionEvent> eventEmitter;
    private final Runnable toolStartedEmitter;
    private final List<PermissionRequirement> grantedRequirements = new CopyOnWriteArrayList<>();
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private volatile PendingApproval currentApproval;

    public PendingToolAuthorization(String sessionId, String turnId, String transcriptUri, String messageId, ToolExecutionRequest request, ToolPermissionChain chain,
                                    Consumer<SessionEvent> eventEmitter, Runnable toolStartedEmitter) {
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.transcriptUri = transcriptUri;
        this.messageId = messageId;
        this.request = request;
        this.chain = chain;
        this.eventEmitter = eventEmitter;
        this.toolStartedEmitter = toolStartedEmitter;
    }

    public String sessionId() { return sessionId; }
    public String turnId() { return turnId; }
    public String transcriptUri() { return transcriptUri; }
    public String messageId() { return messageId; }
    public ToolExecutionRequest request() { return request; }
    public ToolPermissionChain chain() { return chain; }
    public Consumer<SessionEvent> eventEmitter() { return eventEmitter; }
    public Runnable toolStartedEmitter() { return toolStartedEmitter; }
    public List<PermissionRequirement> grantedRequirements() { return grantedRequirements; }
    public PendingApproval currentApproval() { return currentApproval; }
    public void currentApproval(PendingApproval approval) { this.currentApproval = approval; }
    public boolean cancelled() { return cancelled.get(); }
    public void cancel() { cancelled.set(true); }
}
