package com.yu.mboocode.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "聊天请求体")
public record ChatReq(
        @Schema(description = "业务状态码")
        String modelName,

        @Schema(description = "推理深度")
        String reasoningEffort,

        @Schema(description = "用户消息")
        String userMessage,

        @Schema(description = "会话id 为空创建一个")
        String sessionId
) {}
