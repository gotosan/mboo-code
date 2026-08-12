package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "工具结果详情")
public record ToolResultDetailResp(
        @Schema(description = "工具结果 ID") String resultId,
        @Schema(description = "工具调用 ID") String toolCallId,
        @Schema(description = "工具名称") String toolName,
        @Schema(description = "工具调用结束状态") String status,
        @Schema(description = "结果内容类型") String contentType,
        @Schema(description = "前端展示用工具结果摘要") String resultPreview,
        @Schema(description = "工具结果 UTF-8 字节数") Long resultSizeBytes,
        @Schema(description = "是否存在命令原始输出") Boolean rawOutputAvailable,
        @Schema(description = "命令原始输出是否完整") Boolean rawOutputComplete,
        @Schema(description = "命令原始输出 UTF-8 字节数") Long rawOutputSizeBytes,
        @Schema(description = "创建时间") String createdAt
) {
}
