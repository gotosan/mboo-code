package com.yu.mboocode.session.enums;

/**
 * 会话事件类型
 */
public enum SessionEventType {
    TURN_STARTED, //turn 已开始
    TURN_COMPLETED, //turn 已完成
    TURN_FAILED, //turn 执行失败
    TURN_CANCELLED, //turn 已取消
    TURN_SUPERSEDED, //turn 已被新 turn 替换
    USER_MESSAGE, //用户消息
    ASSISTANT_MESSAGE, //助手消息

    TOOL_CALL_STARTED, //工具调用已开始
    TOOL_CALL_COMPLETED, //工具调用已完成
    TOOL_CALL_FAILED, //工具调用失败

    //以下为运行时事件，不写入 JSONL
    ASSISTANT_MESSAGE_DELTA, //助手文本增量，运行时事件
}
