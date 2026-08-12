package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 工具调用开始事件主体。
 */
@Schema(description = "工具调用开始事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolCallStartedPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用参数 JSON 字符串")
    private String arguments;
}
