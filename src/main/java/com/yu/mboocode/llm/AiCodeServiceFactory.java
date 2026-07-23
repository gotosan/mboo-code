package com.yu.mboocode.llm;

import com.yu.mboocode.agent.service.ToolApprovalService;
import com.yu.mboocode.config.Setting;
import com.yu.mboocode.llm.listener.MyAiServiceCompletedListener;
import com.yu.mboocode.llm.listener.MyChatModelListener;
import com.yu.mboocode.llm.service.PersistentChatMemoryStore;
import com.yu.mboocode.llm.tool.FileWritePermissionDemoTool;
import com.yu.mboocode.llm.tool.PermissionToolExecutor;
import com.yu.mboocode.llm.tool.WeatherTool;
import com.yu.mboocode.llm.tool.permission.ToolPermissionRegistry;
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
import java.util.ArrayList;
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
    @Resource
    private ToolPermissionRegistry toolPermissionRegistry;

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

        List<AiServiceTool> tools = new ArrayList<>();
        tools.add(buildPermissionTool(new WeatherTool(), WeatherTool.class, "getWeather", String.class));
        tools.add(buildPermissionTool(new FileWritePermissionDemoTool(), FileWritePermissionDemoTool.class, "demoWriteFile", String.class));

        return AiServices
                .builder(AiCodeService.class)
                .chatModel(chatModel)
                .streamingChatModel(streamingChatModel)
                .chatMemoryProvider(chatMemoryProvider)
                .tools(tools)
                .registerListeners(new MyAiServiceCompletedListener())
                .build();
    }

    private AiServiceTool buildPermissionTool(Object toolInstance, Class<?> toolClass, String methodName, Class<?>... parameterTypes) {
        Method method;
        try {
            method = toolClass.getDeclaredMethod(methodName, parameterTypes);
        } catch (NoSuchMethodException e) {
            throw new IllegalStateException("工具定义无效: " + toolClass.getSimpleName() + "#" + methodName, e);
        }
        toolPermissionRegistry.register(method);
        ToolSpecification specification = ToolSpecifications.toolSpecificationFrom(method);
        PermissionToolExecutor executor = new PermissionToolExecutor(toolInstance, method, toolApprovalService);
        return AiServiceTool.builder().toolSpecification(specification).toolExecutor(executor).build();
    }
}
