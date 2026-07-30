package com.yu.mboocode.llm.tool;

/**
 * 将 LangChain4j 隐藏的工具调用 ID 与 turn ID 传给进程登记层，不暴露为模型参数。
 */
public final class ToolInvocationContext {
    private static final ThreadLocal<Value> CURRENT = new ThreadLocal<>();

    private ToolInvocationContext() {
    }

    public static void set(String sessionId, String turnId, String toolCallId) {
        CURRENT.set(new Value(sessionId, turnId, toolCallId));
    }

    public static Value current() {
        return CURRENT.get();
    }

    public static void clear() {
        CURRENT.remove();
    }

    public record Value(String sessionId, String turnId, String toolCallId) {
    }
}
