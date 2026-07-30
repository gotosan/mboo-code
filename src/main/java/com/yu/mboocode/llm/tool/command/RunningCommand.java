package com.yu.mboocode.llm.tool.command;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public class RunningCommand {
    private final String sessionId;
    private final String turnId;
    private final String toolCallId;
    private final Thread executionThread;
    private final AtomicBoolean terminating = new AtomicBoolean();
    private final AtomicReference<CancelReason> cancelReason = new AtomicReference<>();
    private final CompletableFuture<Boolean> terminationResult = new CompletableFuture<>();
    private volatile Process process;
    private volatile boolean terminationComplete = true;

    public RunningCommand(String sessionId, String turnId, String toolCallId, Thread executionThread) {
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.toolCallId = toolCallId;
        this.executionThread = executionThread;
    }

    public String sessionId() { return sessionId; }
    public String turnId() { return turnId; }
    public String toolCallId() { return toolCallId; }
    public Thread executionThread() { return executionThread; }
    public Process process() { return process; }
    public void process(Process process) { this.process = process; }
    public CancelReason cancelReason() { return cancelReason.get(); }
    public CancelReason markCancelled(CancelReason reason) {
        cancelReason.compareAndSet(null, reason);
        return cancelReason.get();
    }
    public AtomicBoolean terminating() { return terminating; }
    public CompletableFuture<Boolean> terminationResult() { return terminationResult; }
    public boolean terminationComplete() { return terminationComplete; }
    public void terminationComplete(boolean value) { this.terminationComplete = value; }

    public enum CancelReason {
        CANCELLED,
        TIMEOUT,
        INTERRUPTED,
        SHUTDOWN
    }
}
