package com.yu.mboocode.llm.context;

import dev.langchain4j.data.message.ChatMessage;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * ChatMemory 对话 turn：从扁平消息列表中按 UserMessage 划分出的一段对话。
 */
@Schema(description = "ChatMemory 对话 turn")
public record ConversationTurn(
        @Schema(description = "属于本 turn 的消息，第一条必须是 UserMessage")
        List<ChatMessage> messages,

        @Schema(description = "是否包含至少一条助手消息；错误、取消或只有用户消息的 turn 为不完整 turn")
        boolean complete,

        @Schema(description = "本 turn 内工具请求数量")
        int toolCallCount,

        @Schema(description = "本 turn 消息正文合计字符数，用于粗粒度规模判断")
        long serializedCharacters
) {
}
