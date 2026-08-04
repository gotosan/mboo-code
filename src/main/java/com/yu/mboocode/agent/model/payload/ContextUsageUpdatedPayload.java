package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Schema(description = "上下文用量运行时更新事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ContextUsageUpdatedPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "实际使用的模型 ID")
    private String modelId;

    @Schema(description = "输入 Token 数，供应商未提供时为空")
    private Long inputTokens;

    @Schema(description = "输出 Token 数，供应商未提供时为空")
    private Long outputTokens;

    @Schema(description = "实际总 Token 数")
    private Long totalTokens;
}
