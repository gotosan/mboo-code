package com.yu.mboocode.agent.service;

import com.yu.mboocode.agent.dto.ActiveTurnRuntime;
import com.yu.mboocode.agent.model.ContextUsageSnapshot;
import dev.langchain4j.invocation.InvocationContext;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.output.TokenUsage;
import dev.langchain4j.observability.api.event.AiServiceRequestIssuedEvent;
import dev.langchain4j.observability.api.event.AiServiceResponseReceivedEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class ModelUsageTracker {
    private final Map<String, ActiveTurnRuntime> runtimes = new ConcurrentHashMap<>();

    public void register(ActiveTurnRuntime runtime) {
        String sessionId = runtime.getSessionTurn().sessionId();
        ActiveTurnRuntime previous = runtimes.put(sessionId, runtime);
        if (previous != null && previous != runtime) {
            log.warn("替换会话中残留的 usage runtime，sessionId: {}，previousTurnId: {}，newTurnId: {}", sessionId,
                    previous.getSessionTurn().turnId(), runtime.getSessionTurn().turnId());
        }
    }

    public void unregister(ActiveTurnRuntime runtime) {
        runtimes.remove(runtime.getSessionTurn().sessionId(), runtime);
        runtime.clearContextUsageEmitter();
    }

    public void onRequest(AiServiceRequestIssuedEvent event) {
        InvocationContext context = event.invocationContext();
        String sessionId = sessionId(context);
        ActiveTurnRuntime runtime = sessionId == null ? null : runtimes.get(sessionId);
        if (!matches(runtime, context, event.request())) return;
        if (!runtime.bindInvocation(context.invocationId())) {
            log.warn("忽略 invocation 不匹配的模型请求，sessionId: {}，turnId: {}", sessionId, runtime.getSessionTurn().turnId());
        }
    }

    public void onResponse(AiServiceResponseReceivedEvent event) {
        InvocationContext context = event.invocationContext();
        String sessionId = sessionId(context);
        ActiveTurnRuntime runtime = sessionId == null ? null : runtimes.get(sessionId);
        if (!matches(runtime, context, event.request()) || !runtime.matchesInvocation(context.invocationId())) return;

        ContextUsageSnapshot snapshot = normalize(runtime.getModelId(), event.response().tokenUsage());
        if (snapshot == null) {
            log.debug("模型响应没有可用 usage，sessionId: {}，turnId: {}", sessionId, runtime.getSessionTurn().turnId());
            return;
        }
        try {
            runtime.updateContextUsage(snapshot);
        } catch (RuntimeException e) {
            log.warn("推送上下文用量失败，sessionId: {}，turnId: {}", sessionId, runtime.getSessionTurn().turnId(), e);
        }
    }

    private boolean matches(ActiveTurnRuntime runtime, InvocationContext context, ChatRequest request) {
        if (runtime == null || context == null || context.invocationId() == null || request == null || !runtime.isUsageTrackingActive()) return false;
        return runtime.getModelId() != null && runtime.getModelId().equals(request.modelName());
    }

    private String sessionId(InvocationContext context) {
        if (context == null || context.chatMemoryId() == null) return null;
        String sessionId = String.valueOf(context.chatMemoryId());
        return sessionId.isBlank() ? null : sessionId;
    }

    private ContextUsageSnapshot normalize(String modelId, TokenUsage usage) {
        if (usage == null) return null;
        Integer rawInput = usage.inputTokenCount();
        Integer rawOutput = usage.outputTokenCount();
        Integer rawTotal = usage.totalTokenCount();
        Long input = rawInput == null || rawInput < 0 ? null : rawInput.longValue();
        Long output = rawOutput == null || rawOutput < 0 ? null : rawOutput.longValue();
        long total;
        if (rawTotal != null) {
            if (rawTotal < 0) return null;
            total = rawTotal.longValue();
        } else {
            if (input == null || output == null) return null;
            total = input + output;
        }
        return new ContextUsageSnapshot(modelId, input, output, total);
    }
}
