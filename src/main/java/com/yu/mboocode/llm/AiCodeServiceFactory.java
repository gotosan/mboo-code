package com.yu.mboocode.llm;

import com.yu.mboocode.agent.service.ToolApprovalService;
import com.yu.mboocode.config.Setting;
import com.yu.mboocode.llm.listener.MyAiServiceCompletedListener;
import com.yu.mboocode.llm.listener.MyChatModelListener;
import com.yu.mboocode.llm.service.PersistentChatMemoryStore;
import com.yu.mboocode.llm.tool.PermissionToolExecutor;
import com.yu.mboocode.llm.tool.WeatherTool;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.agent.tool.ToolSpecifications;
import dev.langchain4j.memory.chat.ChatMemoryProvider;
import dev.langchain4j.memory.chat.MessageWindowChatMemory;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.StreamingChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import dev.langchain4j.model.openai.OpenAiResponsesStreamingChatModel;
import dev.langchain4j.service.AiServices;
import dev.langchain4j.service.tool.AiServiceTool;
import jakarta.annotation.Resource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.lang.reflect.Method;
import java.util.List;

@Configuration
public class AiCodeServiceFactory {
    private static final int MAX_MEMORY_MESSAGES = 10_000;

    @Resource
    private Setting setting;
    @Resource
    private PersistentChatMemoryStore persistentChatMemoryStore;
    @Resource
    private ToolApprovalService toolApprovalService;

    @Bean
    public ChatMemoryProvider chatMemoryProvider() {
        return memoryId -> MessageWindowChatMemory.builder()
                .id(memoryId)
                .maxMessages(MAX_MEMORY_MESSAGES)
                .alwaysKeepSystemMessageFirst(true)
                .chatMemoryStore(persistentChatMemoryStore)
                .build();
    }

    @Bean
    public AiCodeService getAiCodeService(ChatMemoryProvider chatMemoryProvider) {

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

        WeatherTool weatherTool = new WeatherTool();
        Method weatherMethod;
        try {
            weatherMethod = WeatherTool.class.getDeclaredMethod("getWeather", String.class);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("天气工具定义无效", e);
        }
        ToolSpecification weatherSpecification = ToolSpecifications.toolSpecificationFrom(weatherMethod);
        PermissionToolExecutor weatherExecutor = new PermissionToolExecutor(weatherTool, weatherMethod, toolApprovalService);
        AiServiceTool weatherAiTool = AiServiceTool.builder().toolSpecification(weatherSpecification).toolExecutor(weatherExecutor).build();
        List<AiServiceTool> tools = List.of(weatherAiTool);

        return AiServices
                .builder(AiCodeService.class)
                .chatModel(chatModel)
                .streamingChatModel(streamingChatModel)
                .chatMemoryProvider(chatMemoryProvider)
                .tools(tools)
                .registerListeners(new MyAiServiceCompletedListener())
                .build();
    }
}
