package com.yu.mboocode.llm.context;

import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.ContextSummaryAiService;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.data.message.ChatMessage;
import dev.langchain4j.data.message.ToolExecutionResultMessage;
import dev.langchain4j.data.message.UserMessage;
import dev.langchain4j.model.openai.OpenAiResponsesChatRequestParameters;
import dev.langchain4j.model.output.TokenUsage;
import dev.langchain4j.service.Result;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 无状态、无工具的上下文摘要服务。
 *
 * <p>通过独立构建的 ContextSummaryAiService 调用模型：不使用正式会话 ChatMemory，
 * 不向 ChatMemory 写入摘要提示词或回答，不提供工具，不绑定主对话 ModelUsageTracker，
 * 摘要 usage 也不用于前端上下文圆环。</p>
 */
@Service
@Slf4j
public class ContextSummaryService {
    /**
     * 摘要输出 Token 上限，同时不能超过模型自身输出上限。
     */
    private static final int SUMMARY_MAX_OUTPUT_TOKENS = 4096;

    @Resource
    private ContextSummaryAiService contextSummaryAiService;

    /**
     * 执行一次摘要调用并校验输出。
     *
     * @param modelId            摘要模型 ID（调用方已完成可用性校验）
     * @param modelOutputLimit   摘要模型输出上限，可为空
     * @param lowReasoningSupported 模型是否支持 low 推理深度；不支持时不发送推理参数
     * @param existingSummary    已有摘要，允许为空
     * @param orphanPrefix       无归属历史前缀
     * @param turnsToSummarize   本次将从 messages_json 删除的完整历史 turn
     * @return 校验通过的新摘要文本
     */
    public String summarize(String modelId, Long modelOutputLimit, boolean lowReasoningSupported,
                            String existingSummary, List<ChatMessage> orphanPrefix, List<ConversationTurn> turnsToSummarize) {
        int maxOutputTokens = modelOutputLimit == null
                ? SUMMARY_MAX_OUTPUT_TOKENS
                : (int) Math.min(SUMMARY_MAX_OUTPUT_TOKENS, modelOutputLimit);

        OpenAiResponsesChatRequestParameters parameters = OpenAiResponsesChatRequestParameters.builder()
                .modelName(modelId)
                .reasoningEffort(lowReasoningSupported ? "low" : null)
                .maxOutputTokens(maxOutputTokens)
                .build();

        Result<String> result;
        try {
            result = contextSummaryAiService.summarize(buildUserInput(existingSummary, orphanPrefix, turnsToSummarize), parameters);
        } catch (RuntimeException e) {
            log.warn("摘要模型调用失败 modelId:{} 原因:{}", modelId, e.getMessage());
            throw new ServiceException("摘要模型调用失败");
        }

        // 摘要服务未配置工具，模型若返回工具调用则文本为空，由空摘要校验兜底
        String summary = result == null ? null : result.content();
        if (summary == null || summary.isBlank()) {
            throw new ServiceException("摘要模型返回了空摘要");
        }
        TokenUsage usage = result.tokenUsage();
        if (usage != null && usage.outputTokenCount() != null && usage.outputTokenCount() > maxOutputTokens) {
            throw new ServiceException("摘要输出超过 Token 上限");
        }
        return summary.trim();
    }

    /**
     * 摘要输入只包含已有摘要、无归属前缀和待删除历史 turn；最近保留的 turn 不发送。
     */
    private String buildUserInput(String existingSummary, List<ChatMessage> orphanPrefix, List<ConversationTurn> turns) {
        StringBuilder input = new StringBuilder();
        input.append("<existing-summary>\n");
        if (existingSummary != null && !existingSummary.isBlank()) {
            input.append(existingSummary.trim()).append('\n');
        }
        input.append("</existing-summary>\n\n");
        if (orphanPrefix != null && !orphanPrefix.isEmpty()) {
            input.append("<orphan-history>\n");
            for (ChatMessage message : orphanPrefix) {
                appendMessage(input, message);
            }
            input.append("</orphan-history>\n\n");
        }
        input.append("<historical-turns>\n");
        for (int i = 0; i < turns.size(); i++) {
            input.append("<turn index=\"").append(i + 1).append("\">\n");
            for (ChatMessage message : turns.get(i).messages()) {
                appendMessage(input, message);
            }
            input.append("</turn>\n");
        }
        input.append("</historical-turns>");
        return input.toString();
    }

    private void appendMessage(StringBuilder input, ChatMessage message) {
        if (message instanceof UserMessage userMessage) {
            input.append("[用户] ").append(userMessage.hasSingleText() ? userMessage.singleText() : userMessage.contents()).append('\n');
        } else if (message instanceof AiMessage aiMessage) {
            if (aiMessage.text() != null && !aiMessage.text().isBlank()) {
                input.append("[助手] ").append(aiMessage.text()).append('\n');
            }
            if (aiMessage.toolExecutionRequests() != null) {
                for (ToolExecutionRequest request : aiMessage.toolExecutionRequests()) {
                    input.append("[工具请求] ").append(request.name()).append(' ').append(request.arguments()).append('\n');
                }
            }
        } else if (message instanceof ToolExecutionResultMessage resultMessage) {
            input.append("[工具结果] ").append(resultMessage.toolName()).append(' ').append(resultMessage.text()).append('\n');
        }
    }
}