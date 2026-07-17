package com.yu.mboocode.llm.service;

import com.yu.mboocode.llm.model.ChatMemory;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ChatMessageDeserializer;
import dev.langchain4j.data.message.ChatMessageSerializer;
import dev.langchain4j.store.memory.chat.ChatMemoryStore;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.List;

@Slf4j
@Component
public class PersistentChatMemoryStore implements ChatMemoryStore {
    @Resource
    private ChatMemoryService chatMemoryService;

    @Override
    public List<ChatMessage> getMessages(Object memoryId) {
        String id = (String) memoryId;
        ChatMemory chatMemory = chatMemoryService.getById(id);
        if (chatMemory == null) {
            return Collections.emptyList();
        }

        List<ChatMessage> messages = ChatMessageDeserializer.messagesFromJson(chatMemory.getMessagesJson());
        log.debug("读取会话记忆，memoryId: {}，消息数量: {}", id, messages.size());
        return messages;
    }

    @Override
    public void updateMessages(Object memoryId, List<ChatMessage> messages) {
        String id = (String) memoryId;

        ChatMemory chatMemory = new ChatMemory();
        chatMemory.setMemoryId(id);
        chatMemory.setMessagesJson(ChatMessageSerializer.messagesToJson(messages));
        chatMemoryService.saveOrUpdate(chatMemory);
        log.debug("更新会话记忆，memoryId: {}，消息数量: {}", id, messages.size());
    }

    @Override
    public void deleteMessages(Object memoryId) {
        String id = (String) memoryId;
        chatMemoryService.removeById(id);
        log.debug("删除会话记忆，memoryId: {}", id);
    }
}
