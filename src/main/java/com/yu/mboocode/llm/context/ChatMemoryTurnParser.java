package com.yu.mboocode.llm.context;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.SystemMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.ArrayList;
import java.util.List;

/**
 * ChatMemory 对话 turn 解析器。
 *
 * <p>规则：每个 UserMessage 开始一个新 turn；SystemMessage 不属于任何 turn；
 * 第一个 UserMessage 之前的非系统消息属于无归属前缀；错误、取消或只有 UserMessage
 * 的不完整 turn 仍计为一个 turn。</p>
 */
public final class ChatMemoryTurnParser {

    private ChatMemoryTurnParser() {
    }

    /**
     * 把扁平消息列表解析为系统消息、无归属前缀和对话 turn 列表。
     */
    public static ParsedConversation parse(List<ChatMessage> messages) {
        List<ChatMessage> systemMessages = new ArrayList<>();
        List<ChatMessage> orphanPrefix = new ArrayList<>();
        List<List<ChatMessage>> turnMessages = new ArrayList<>();

        List<ChatMessage> current = null;
        for (ChatMessage message : messages) {
            if (message instanceof SystemMessage) {
                systemMessages.add(message);
                continue;
            }
            if (message instanceof UserMessage) {
                current = new ArrayList<>();
                turnMessages.add(current);
                current.add(message);
                continue;
            }
            if (current == null) {
                orphanPrefix.add(message);
                continue;
            }
            current.add(message);
        }

        List<ConversationTurn> turns = new ArrayList<>(turnMessages.size());
        for (List<ChatMessage> items : turnMessages) {
            turns.add(toTurn(items));
        }
        return new ParsedConversation(systemMessages, orphanPrefix, turns);
    }

    private static ConversationTurn toTurn(List<ChatMessage> messages) {
        boolean complete = false;
        int toolCallCount = 0;
        long characters = 0;
        for (ChatMessage message : messages) {
            if (message instanceof AiMessage aiMessage) {
                complete = true;
                List<ToolExecutionRequest> requests = aiMessage.toolExecutionRequests();
                toolCallCount += requests == null ? 0 : requests.size();
            }
            characters += messageCharacters(message);
        }
        return new ConversationTurn(List.copyOf(messages), complete, toolCallCount, characters);
    }

    /**
     * 消息正文字符数：助手文本、工具请求参数、工具结果和用户文本都计入。
     */
    public static long messageCharacters(ChatMessage message) {
        long count = 0;
        if (message instanceof UserMessage userMessage && userMessage.hasSingleText()) {
            count += userMessage.singleText().length();
        } else if (message instanceof AiMessage aiMessage) {
            if (aiMessage.text() != null) {
                count += aiMessage.text().length();
            }
            if (aiMessage.toolExecutionRequests() != null) {
                for (ToolExecutionRequest request : aiMessage.toolExecutionRequests()) {
                    count += request.arguments() == null ? 0 : request.arguments().length();
                }
            }
        } else if (message instanceof ToolExecutionResultMessage resultMessage) {
            count += resultMessage.text() == null ? 0 : resultMessage.text().length();
        } else if (message instanceof SystemMessage systemMessage) {
            count += systemMessage.text() == null ? 0 : systemMessage.text().length();
        }
        return count;
    }

    /**
     * 扁平消息列表的解析结果。
     */
    @Schema(description = "ChatMemory 解析结果")
    public record ParsedConversation(
            @Schema(description = "系统消息，当前最多一条")
            List<ChatMessage> systemMessages,

            @Schema(description = "第一个 UserMessage 之前的无归属历史前缀")
            List<ChatMessage> orphanPrefix,

            @Schema(description = "按 UserMessage 划分的对话 turn，按时间升序")
            List<ConversationTurn> turns
    ) {
        /**
         * 重组为扁平消息列表：系统消息 + 无归属前缀 + 各 turn 消息。
         */
        public List<ChatMessage> flatten() {
            List<ChatMessage> result = new ArrayList<>(systemMessages);
            result.addAll(orphanPrefix);
            for (ConversationTurn turn : turns) {
                result.addAll(turn.messages());
            }
            return result;
        }
    }
}
