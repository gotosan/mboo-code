package com.yu.mboocode.llm.listener;

import com.yu.mboocode.agent.service.ModelUsageTracker;
import dev.langchain4j.observability.api.event.AiServiceRequestIssuedEvent;
import dev.langchain4j.observability.api.listener.AiServiceRequestIssuedListener;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

@Component
public class ModelUsageRequestListener implements AiServiceRequestIssuedListener {
    @Resource
    private ModelUsageTracker modelUsageTracker;

    @Override
    public void onEvent(AiServiceRequestIssuedEvent event) {
        modelUsageTracker.onRequest(event);
    }
}
