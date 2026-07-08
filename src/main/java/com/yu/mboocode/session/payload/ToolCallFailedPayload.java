package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 工具调用失败事件主体。
 */
@Schema(description = "工具调用失败事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolCallFailedPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用参数 JSON 字符串")
    private String arguments;

    @Schema(description = "工具结果摘要")
    private String resultPreview;

    @Schema(description = "错误编码")
    private String errorCode;

    @Schema(description = "错误信息")
    private String errorMessage;

    @Schema(description = "工具调用耗时，单位毫秒")
    private Long durationMs;
}
