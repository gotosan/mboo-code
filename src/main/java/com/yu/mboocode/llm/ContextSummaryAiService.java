package com.yu.mboocode.llm;

import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.service.Result;
import dev.langchain4j.service.SystemMessage;
import dev.langchain4j.service.UserMessage;

/**
 * 上下文压缩摘要 AI Service。
 *
 * <p>与 AiCodeService 分开构建：不配置工具、ChatMemory、系统消息转换器和主对话 usage 监听器，
 * 保证摘要调用无状态、不读写正式会话记忆、不污染主对话 Token 用量统计。
 * 返回 Result 以便调用方继续校验摘要输出 Token 上限。</p>
 */
public interface ContextSummaryAiService {
    @SystemMessage(fromResource = "prompt/context-summary-prompt.txt")
    Result<String> summarize(@UserMessage String message, ChatRequestParameters params);
}