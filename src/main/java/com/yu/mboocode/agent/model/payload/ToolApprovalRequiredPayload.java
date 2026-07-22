package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 工具等待用户授权事件主体。
 */
@Schema(description = "工具等待用户授权事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolApprovalRequiredPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "授权请求 ID")
    private String approvalId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用参数 JSON 字符串")
    private String arguments;

    @Schema(description = "授权提示标题")
    private String title;

    @Schema(description = "授权提示说明")
    private String description;
}
