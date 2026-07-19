package com.yu.mboocode.session.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "聊天请求体")
public record ChatReq(
        @Schema(description = "模型名称")
        @NotBlank(message = "模型名称不能为空")
        String modelName,

        @Schema(description = "推理深度，仅 provider 支持时生效")
        String reasoningEffort,

        @Schema(description = "用户消息")
        @NotBlank(message = "用户消息不能为空")
        String userMessage,

        @Schema(description = "新会话工作区绝对路径，仅创建新会话时生效")
        String workspacePath,

        @Schema(description = "会话 ID，为空时创建新会话")
        String sessionId
) {}
