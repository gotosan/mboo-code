package com.yu.mboocode.agent.model;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "模型上下文用量快照")
public record ContextUsageSnapshot(
        @Schema(description = "实际使用的模型 ID") String modelId,
        @Schema(description = "输入 Token 数，供应商未提供时为空") Long inputTokens,
        @Schema(description = "输出 Token 数，供应商未提供时为空") Long outputTokens,
        @Schema(description = "实际总 Token 数") Long totalTokens
) {
}
