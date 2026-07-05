package com.yu.mboocode.session.model;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 当前请求对应的会话 turn 上下文。
 */
@Schema(description = "会话 turn 上下文")
public record SessionTurn(
        @Schema(description = "会话 ID")
        String sessionId,

        @Schema(description = "会话 JSONL 文件路径或相对 URI")
        String transcriptUri,

        @Schema(description = "本轮 turn ID")
        String turnId,

        @Schema(description = "用户消息 ID")
        String userMessageId,

        @Schema(description = "助手消息 ID")
        String assistantMessageId
) {
}
