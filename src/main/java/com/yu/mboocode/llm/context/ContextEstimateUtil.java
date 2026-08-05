package com.yu.mboocode.llm.context;

import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.model.openai.OpenAiTokenCountEstimator;
import lombok.extern.slf4j.Slf4j;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 内部 Token 估算工具。
 *
 * <p>只用于压缩候选选择和新消息硬预算保护；估算结果不能写入 ContextUsageSnapshot，
 * 不能用于前端圆环，也不能对外宣称为实际用量。模型标识无法被估算器识别时
 * 退化为保守字符预算（按 2 字符约 1 Token 高估，宁可保守也不低估）。</p>
 */
@Slf4j
public final class ContextEstimateUtil {

    /**
     * 每条消息的固定结构开销估算。
     */
    private static final int MESSAGE_OVERHEAD_TOKENS = 4;

    private static final Map<String, OpenAiTokenCountEstimator> ESTIMATORS = new ConcurrentHashMap<>();

    private ContextEstimateUtil() {
    }

    /**
     * 估算单条文本的 Token 数。
     */
    public static long estimateTextTokens(String modelId, String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        OpenAiTokenCountEstimator estimator = estimator(modelId);
        if (estimator != null) {
            try {
                return estimator.estimateTokenCountInText(text);
            } catch (RuntimeException e) {
                log.debug("Token 估算失败，退化为字符预算 modelId:{}", modelId);
            }
        }
        return conservativeCharTokens(text.length());
    }

    /**
     * 估算一组消息的 Token 数，包含每条消息的结构开销。
     */
    public static long estimateMessagesTokens(String modelId, Iterable<ChatMessage> messages) {
        if (messages == null) {
            return 0;
        }
        OpenAiTokenCountEstimator estimator = estimator(modelId);
        if (estimator != null) {
            try {
                return estimator.estimateTokenCountInMessages(messages);
            } catch (RuntimeException e) {
                log.debug("消息 Token 估算失败，退化为字符预算 modelId:{}", modelId);
            }
        }
        long total = 0;
        for (ChatMessage message : messages) {
            total += conservativeCharTokens(ChatMemoryTurnParser.messageCharacters(message)) + MESSAGE_OVERHEAD_TOKENS;
        }
        return total;
    }

    private static long conservativeCharTokens(long characters) {
        return Math.max(1, (characters + 1) / 2);
    }

    private static OpenAiTokenCountEstimator estimator(String modelId) {
        if (modelId == null || modelId.isBlank()) {
            return null;
        }
        try {
            return ESTIMATORS.computeIfAbsent(modelId, id -> {
                try {
                    return new OpenAiTokenCountEstimator(id);
                } catch (RuntimeException e) {
                    return null;
                }
            });
        } catch (RuntimeException e) {
            return null;
        }
    }
}
