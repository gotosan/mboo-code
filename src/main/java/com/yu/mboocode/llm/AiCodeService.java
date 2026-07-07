package com.yu.mboocode.llm;

import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.TokenStream;
import dev.langchain4j.service.UserMessage;

public interface AiCodeService {
    @SystemMessage(fromResource = "system-prompt.txt")
    TokenStream chatStream(@UserMessage String message, ChatRequestParameters params);
}
