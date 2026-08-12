package com.yu.mboocode.agent.model;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 工具结果独立制品。
 */
@Schema(description = "工具结果独立制品")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolResultArtifact {
    @Schema(description = "制品结构版本")
    private Integer schemaVersion;

    @Schema(description = "工具结果 ID")
    private String resultId;

    @Schema(description = "会话 ID")
    private String sessionId;

    @Schema(description = "轮次 ID")
    private String turnId;

    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用结束状态")
    private String status;

    @Schema(description = "结果内容类型")
    private String contentType;

    @Schema(description = "返回给模型的完整工具结果")
    private String resultText;

    @Schema(description = "前端展示用工具结果摘要")
    private String resultPreview;

    @Schema(description = "工具结果 UTF-8 字节数")
    private Long resultSizeBytes;

    @Schema(description = "是否存在命令原始输出")
    private Boolean rawOutputAvailable;

    @Schema(description = "命令原始输出是否完整")
    private Boolean rawOutputComplete;

    @Schema(description = "命令原始输出 UTF-8 字节数")
    private Long rawOutputSizeBytes;

    @Schema(description = "创建时间")
    private String createdAt;
}
