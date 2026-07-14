package com.yu.mboocode.llm;

import com.yu.mboocode.llm.model.ChatMemory;
import com.yu.mboocode.llm.service.ChatMemoryService;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ChatMessageDeserializer;
import dev.langchain4j.data.message.ChatMessageSerializer;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Slf4j
@Component
public class PersistentChatMemoryStore implements ChatMemoryStore {
    @Resource
    private ChatMemoryService chatMemoryService;
    // LangChain4j 会先写入再读取 SystemMessage 来组装当前请求，因此仅在进程内暂存，避免过滤落库时误删当前提示词。
    private final ConcurrentMap<String, SystemMessage> systemMessages = new ConcurrentHashMap<>();

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        String id = (String) memoryId;
        ChatMemory chatMemory = chatMemoryService.getById(id);
        if (chatMemory == null) {
            return Collections.emptyList();
        }

        List<ChatMessage> messages = new ArrayList<>();
        Optional.ofNullable(systemMessages.get(id)).ifPresent(messages::add);
        messages.addAll(ChatMessageDeserializer.messagesFromJson(chatMemory.getMessagesJson()));
        log.debug("读取会话记忆，memoryId: {}，消息数量: {}", id, messages.size());
        return messages;
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        String id = (String) memoryId;
        // System Prompt 每次请求都会动态提供，不持久化可避免应用重启后重复注入。
        messages.stream()
                .filter(SystemMessage.class::isInstance)
                .map(SystemMessage.class::cast)
                .findFirst()
                .ifPresent(systemMessage -> systemMessages.put(id, systemMessage));
        List<ChatMessage> persistentMessages = messages.stream()
                .filter(message -> !(message instanceof SystemMessage))
                .toList();
        String messagesJson = ChatMessageSerializer.messagesToJson(persistentMessages);

        ChatMemory chatMemory = new ChatMemory();
        chatMemory.setMemoryId(id);
        chatMemory.setMessagesJson(messagesJson);
        chatMemoryService.saveOrUpdate(chatMemory);
        log.debug("更新会话记忆，memoryId: {}，消息数量: {}", id, persistentMessages.size());
    }

    @Override
    public void deleteMessages(Object memoryId) {
        String id = (String) memoryId;
        systemMessages.remove(id);
        chatMemoryService.removeById(id);
        log.debug("删除会话记忆，memoryId: {}", id);
    }
}
