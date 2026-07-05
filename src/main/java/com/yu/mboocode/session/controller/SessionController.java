package com.yu.mboocode.session.controller;

import com.yu.mboocode.common.enums.SSEEvent;
import com.yu.mboocode.llm.LLMUtil;
import com.yu.mboocode.session.dto.ChatReq;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.service.TurnService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.jspecify.annotations.NonNull;
import org.springframework.http.MediaType;
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
    private TurnService turnService;

    @Operation(summary = "聊天")
    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<@NonNull ServerSentEvent<@NonNull SessionEvent>> chat(@Valid @RequestBody ChatReq req) {
        return Flux.defer(() ->
                turnService.chatTurn(req.sessionId(), req.userMessage(), LLMUtil.buildChatReq(req.modelName(), req.reasoningEffort()))
                        .map(e -> ServerSentEvent.<SessionEvent>builder().event(SSEEvent.SESSION.getCode()).data(e).build())
        );
    }
}
