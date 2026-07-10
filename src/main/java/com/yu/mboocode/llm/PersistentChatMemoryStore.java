package com.yu.mboocode.llm;

import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import lombok.extern.slf4j.Slf4j;

import java.util.*;

@Slf4j
public class PersistentChatMemoryStore implements ChatMemoryStore {
    private final Map<String, List<ChatMessage>> map = new HashMap<>();

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        log.info("mess id {}", memoryId);
        return map.getOrDefault((String) memoryId, Collections.emptyList());
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        map.put((String) memoryId, messages);
        log.info("mess {}", messages);
    }

    @Override
    public void deleteMessages(Object memoryId) {
    }
}
