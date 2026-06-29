package com.yu.mboocode.llm;

import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;
import reactor.core.publisher.Flux;

public interface AiCodeService {
    @SystemMessage(fromResource = "system-prompt.txt")
    Flux<String> chatStream(@UserMessage String message, ChatRequestParameters params);
}
