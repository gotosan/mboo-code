package com.yu.mboocode.llm;

import com.yu.mboocode.config.Setting;
import com.yu.mboocode.llm.listener.MyAiServiceCompletedListener;
import com.yu.mboocode.llm.listener.MyChatModelListener;
import com.yu.mboocode.llm.tool.WeatherTool;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiResponsesStreamingChatModel;
import dev.langchain4j.service.AiServices;
import jakarta.annotation.Resource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class AiCodeServiceFactory {
    @Resource
    private Setting setting;

    @Bean
    public AiCodeService getAiCodeService() {

        ChatModel chatModel = OpenAiChatModel
                .builder()
                .apiKey(setting.getApiKey())
                .baseUrl(setting.getBaseUrl())
                .modelName("")
                .listeners(List.of(new MyChatModelListener()))
                .build();

        StreamingChatModel streamingChatModel = OpenAiResponsesStreamingChatModel
                .builder()
                .apiKey(setting.getApiKey())
                .baseUrl(setting.getBaseUrl())
                .modelName("")
                .listeners(List.of(new MyChatModelListener()))
                .build();


        return AiServices
                .builder(AiCodeService.class)
                .chatModel(chatModel)
                .streamingChatModel(streamingChatModel)
                .chatMemoryProvider(memoryId ->
                        MessageWindowChatMemory.builder()
                                .id(memoryId)
                                .maxMessages(10)
                                .chatMemoryStore(new PersistentChatMemoryStore())
                                .build()
                )
                .tools(List.of(new WeatherTool()))
                .registerListeners(new MyAiServiceCompletedListener())
                .build();
    }
}
