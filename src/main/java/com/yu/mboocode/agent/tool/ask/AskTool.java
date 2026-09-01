package com.yu.mboocode.agent.tool.ask;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.ToolException;
import com.yu.mboocode.agent.tool.ToolInvocationContext;
import com.yu.mboocode.agent.tool.dto.ToolResult;
import com.yu.mboocode.agent.tool.permission.ToolPermission;
import com.yu.mboocode.agent.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;

/** 模型需要用户明确业务取舍时使用的交互型工具。 */
@Component
public class AskTool {
    @Resource
    private AskService askService;

    @Tool(name = "ask_user_question", value = "当存在会影响结果、范围、验收或风险的关键歧义，且无法从上下文、工具或合理默认值可靠确定时，主动向用户提问并提供最多三个推荐回答；最多一次性提出 3 个问题。")
    @ToolPermission(ToolPermissionType.NONE)
    public String ask(@P(name = "questions", value = "问题页数组，每页包含 question 和 answers；每页恰有一个 recommended=true") List<AskQuestion> questions,
                      @ToolMemoryId String sessionId) {
        ToolInvocationContext.Value context = ToolInvocationContext.current();
        if (context == null || context.turnId() == null || context.toolCallId() == null) {
            throw new AskToolException("ASK_INVALID_CONTEXT", "提问运行上下文无效");
        }
        List<AskQuestion> normalized = AskService.validateAndNormalize(questions);
        try {
            return JSON.toJSONString(ToolResult.completed(askService.await(sessionId, context.turnId(), context.toolCallId(), normalized)));
        } catch (AskToolException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new AskToolException("ASK_FAILED", "提问处理失败", e);
        }
    }

    @Schema(description = "ask 问题页")
    public record AskQuestion(String question, List<AskAnswer> answers) {}

    @Schema(description = "ask 选项")
    public record AskAnswer(String text, String description, Boolean recommended) {}

    public static class AskToolException extends ToolException {
        private final String errorCode;
        public AskToolException(String errorCode, String message) { this(errorCode, message, null); }
        public AskToolException(String errorCode, String message, Throwable cause) {
            super(JSON.toJSONString(ToolResult.failed(errorCode, message)), cause);
            this.errorCode = errorCode;
        }
        @Override public String toResultJson() { return getMessage(); }
        public String errorCode() { return errorCode; }
    }
}
