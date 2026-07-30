package com.yu.mboocode.agent.tool;

/**
 * 工具可预期失败。异常消息保存统一结果 JSON，确保 LangChain4j 将其作为失败工具结果返回。
 */
public abstract class ToolException extends RuntimeException {
    protected ToolException(String resultJson) {
        super(resultJson);
    }

    protected ToolException(String resultJson, Throwable cause) {
        super(resultJson, cause);
    }

    public abstract String toResultJson();
}
