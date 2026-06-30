package com.yu.mboocode.controller;

import com.yu.mboocode.dto.ChatReq;
import com.yu.mboocode.llm.AiCodeService;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.model.openai.OpenAiResponsesChatRequestParameters;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

@Tag(name = "会话")
@RestController
@RequestMapping("/session")
public class SessionController {
    @Resource
    private AiCodeService aiCodeService;

    @Operation(summary = "聊天")
    @PostMapping("/chat")
    public Flux<ServerSentEvent<String>> chat(@RequestBody ChatReq chatReq) {


        ChatRequestParameters chatRequestParameters = OpenAiResponsesChatRequestParameters
                .builder()
                .modelName(chatReq.modelName())
                .reasoningEffort(chatReq.reasoningEffort())
                .build();
        return aiCodeService.chatStream(chatReq.userMessage(), chatRequestParameters).map(chunk -> ServerSentEvent.<String>builder().data(chunk).build());
    }
}
