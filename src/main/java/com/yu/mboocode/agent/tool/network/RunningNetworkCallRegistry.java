package com.yu.mboocode.agent.tool.network;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RunningNetworkCallRegistry {
    private final Map<String, RunningNetworkCall> calls = new ConcurrentHashMap<>();

    public RunningNetworkCall register(String sessionId, String turnId, String toolCallId) {
        RunningNetworkCall call = new RunningNetworkCall(sessionId, turnId, toolCallId, Thread.currentThread());
        RunningNetworkCall existing = calls.putIfAbsent(key(sessionId, toolCallId), call);
        if (existing != null) throw new IllegalStateException("网络调用已登记: " + toolCallId);
        return call;
    }

    public void remove(RunningNetworkCall call) {
        calls.remove(key(call.sessionId(), call.toolCallId()), call);
    }

    public void cancelTurn(String sessionId, String turnId) {
        calls.values().stream().filter(call -> call.sessionId().equals(sessionId) && Objects.equals(call.turnId(), turnId)).forEach(RunningNetworkCall::cancel);
    }

    public void clearSession(String sessionId) {
        calls.values().stream().filter(call -> call.sessionId().equals(sessionId)).forEach(RunningNetworkCall::cancel);
    }

    @PreDestroy
    public void shutdown() {
        calls.values().forEach(RunningNetworkCall::cancel);
    }

    private String key(String sessionId, String toolCallId) {
        return sessionId + ":" + toolCallId;
    }
}
