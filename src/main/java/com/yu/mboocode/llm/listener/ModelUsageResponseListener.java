package com.yu.mboocode.llm.listener;

import com.yu.mboocode.agent.service.ModelUsageTracker;
import dev.langchain4j.observability.api.event.AiServiceResponseReceivedEvent;
import dev.langchain4j.observability.api.listener.AiServiceResponseReceivedListener;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

@Component
public class ModelUsageResponseListener implements AiServiceResponseReceivedListener {
    @Resource
    private ModelUsageTracker modelUsageTracker;

    @Override
    public void onEvent(AiServiceResponseReceivedEvent event) {
        modelUsageTracker.onResponse(event);
    }
}
