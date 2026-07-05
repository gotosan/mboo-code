package com.yu.mboocode.session.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 从会话事件日志中还原出的普通聊天消息。
 */
@Schema(description = "普通聊天消息")
public record ConversationMessage(
        @Schema(description = "消息角色，可选值：user、assistant")
        String role,

        @Schema(description = "消息文本")
        String text
) {
}
