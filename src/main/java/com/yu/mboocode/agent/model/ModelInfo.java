package com.yu.mboocode.agent.model;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Schema(description = "模型能力信息")
public record ModelInfo(
        @Schema(description = "模型 ID") String modelId,
        @Schema(description = "模型显示名称") String name,
        @Schema(description = "模型家族") String family,
        @Schema(description = "模型状态") String status,
        @Schema(description = "模型 Token 能力上限") ModelLimit limit,
        @Schema(description = "是否支持工具调用") boolean toolCall,
        @Schema(description = "是否支持推理") boolean reasoning,
        @Schema(description = "推理选项原始元数据") List<Map<String, Object>> reasoningOptions,
        @Schema(description = "是否支持附件") boolean attachment,
        @Schema(description = "输入模态") List<String> inputModalities,
        @Schema(description = "输出模态") List<String> outputModalities
) {
    public ModelInfo {
        reasoningOptions = freezeReasoningOptions(reasoningOptions);
        inputModalities = inputModalities == null ? List.of() : List.copyOf(inputModalities);
        outputModalities = outputModalities == null ? List.of() : List.copyOf(outputModalities);
    }

    private static List<Map<String, Object>> freezeReasoningOptions(List<Map<String, Object>> options) {
        if (options == null || options.isEmpty()) return List.of();
        List<Map<String, Object>> result = new ArrayList<>(options.size());
        for (Map<String, Object> option : options) {
            if (option == null) continue;
            result.add(freezeMap(option));
        }
        return List.copyOf(result);
    }

    private static Map<String, Object> freezeMap(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> result.put(String.valueOf(key), freezeValue(value)));
        return Collections.unmodifiableMap(result);
    }

    private static Object freezeValue(Object value) {
        if (value instanceof Map<?, ?> map) return freezeMap(map);
        if (value instanceof List<?> list) return Collections.unmodifiableList(list.stream().map(ModelInfo::freezeValue).toList());
        return value;
    }
}
