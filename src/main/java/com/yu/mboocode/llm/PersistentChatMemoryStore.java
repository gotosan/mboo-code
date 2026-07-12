package com.yu.mboocode.llm;

import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Slf4j
@Component
public class PersistentChatMemoryStore implements ChatMemoryStore {
    private final ConcurrentMap<String, List<ChatMessage>> map = new ConcurrentHashMap<>();

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        log.info("读取会话记忆，memoryId: {}", memoryId);
        return map.getOrDefault((String) memoryId, Collections.emptyList());
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        map.put((String) memoryId, List.copyOf(messages));
        log.info("更新会话记忆，memoryId: {}, messages: {}", memoryId, messages);
    }

    @Override
    public void deleteMessages(Object memoryId) {
        map.remove((String) memoryId);
    }
}
