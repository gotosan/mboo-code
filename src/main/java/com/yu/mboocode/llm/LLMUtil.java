package com.yu.mboocode.llm;

import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.model.openai.OpenAiResponsesChatRequestParameters;

public class LLMUtil {
    public static ChatRequestParameters buildChatReq(String modelName, String reasoningEffort) {
        ChatRequestParameters chatRequestParameters = OpenAiResponsesChatRequestParameters
                .builder()
                .modelName(modelName)
                .reasoningEffort(reasoningEffort)
                .build();
        return chatRequestParameters;
    }
}
