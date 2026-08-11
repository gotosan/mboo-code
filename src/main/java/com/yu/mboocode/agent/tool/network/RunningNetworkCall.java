package com.yu.mboocode.agent.tool.network;

import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class RunningNetworkCall {
    private final String sessionId;
    private final String turnId;
    private final String toolCallId;
    private final Thread executionThread;
    private final AtomicBoolean cancelled = new AtomicBoolean();
    private final AtomicReference<HttpUriRequestBase> request = new AtomicReference<>();

    RunningNetworkCall(String sessionId, String turnId, String toolCallId, Thread executionThread) {
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.toolCallId = toolCallId;
        this.executionThread = executionThread;
    }

    public void bind(HttpUriRequestBase currentRequest) {
        request.set(currentRequest);
        if (cancelled.get()) currentRequest.cancel();
    }

    public void unbind(HttpUriRequestBase currentRequest) {
        request.compareAndSet(currentRequest, null);
    }

    public void cancel() {
        if (!cancelled.compareAndSet(false, true)) return;
        HttpUriRequestBase currentRequest = request.get();
        if (currentRequest != null) currentRequest.cancel();
        executionThread.interrupt();
    }

    public boolean cancelled() {
        return cancelled.get();
    }

    public String sessionId() {
        return sessionId;
    }

    public String turnId() {
        return turnId;
    }

    public String toolCallId() {
        return toolCallId;
    }
}
