package com.yu.mboocode.llm;

import cn.hutool.core.util.StrUtil;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.model.openai.OpenAiResponsesChatRequestParameters;

public class LLMUtil {
    public static ChatRequestParameters buildChatReq(String modelName, String reasoningEffort) {
        ChatRequestParameters chatRequestParameters = OpenAiResponsesChatRequestParameters
                .builder()
                .modelName(modelName)
                .reasoningEffort(StrUtil.blankToDefault(reasoningEffort, "medium"))
                .build();
        return chatRequestParameters;
    }
}
