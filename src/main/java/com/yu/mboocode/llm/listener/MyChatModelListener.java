package com.yu.mboocode.llm.listener;

import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.chat.listener.ChatModelErrorContext;
import dev.langchain4j.model.chat.listener.ChatModelListener;
import dev.langchain4j.model.chat.listener.ChatModelRequestContext;
import dev.langchain4j.model.chat.listener.ChatModelResponseContext;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.response.ChatResponse;
import lombok.extern.slf4j.Slf4j;

import java.util.List;

@Slf4j
public class MyChatModelListener implements ChatModelListener {
    @Override
    public void onRequest(ChatModelRequestContext requestContext) {
        ChatRequest chatRequest = requestContext.chatRequest();
        List<ChatMessage> messages = chatRequest.messages();
        log.info("onRequest messages: {}", messages);
    }

    @Override
    public void onResponse(ChatModelResponseContext responseContext) {
        ChatResponse chatResponse = responseContext.chatResponse();
        AiMessage aiMessage = chatResponse.aiMessage();
        log.info("onResponse aiMessage: {}", aiMessage);
    }

    @Override
    public void onError(ChatModelErrorContext errorContext) {
        Throwable error = errorContext.error();
        ChatRequest chatRequest = errorContext.chatRequest();
        log.error("onError chatRequest: {}", chatRequest, error);
    }
}
