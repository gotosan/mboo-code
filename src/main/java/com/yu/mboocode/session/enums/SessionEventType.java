package com.yu.mboocode.session.enums;

import com.yu.mboocode.session.payload.AssistantMessageDeltaPayload;
import com.yu.mboocode.session.payload.AssistantMessagePayload;
import com.yu.mboocode.session.payload.SessionEventPayload;
import com.yu.mboocode.session.payload.ToolCallCompletedPayload;
import com.yu.mboocode.session.payload.ToolCallFailedPayload;
import com.yu.mboocode.session.payload.ToolCallStartedPayload;
import com.yu.mboocode.session.payload.TurnCancelledPayload;
import com.yu.mboocode.session.payload.TurnCompletedPayload;
import com.yu.mboocode.session.payload.TurnFailedPayload;
import com.yu.mboocode.session.payload.TurnStartedPayload;
import com.yu.mboocode.session.payload.TurnSupersededPayload;
import com.yu.mboocode.session.payload.UserMessagePayload;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 会话事件类型
 */
@Getter
@AllArgsConstructor
public enum SessionEventType {
    TURN_STARTED(TurnStartedPayload.class), //turn 已开始
    TURN_COMPLETED(TurnCompletedPayload.class), //turn 已完成
    TURN_FAILED(TurnFailedPayload.class), //turn 执行失败
    TURN_CANCELLED(TurnCancelledPayload.class), //turn 已取消
    TURN_SUPERSEDED(TurnSupersededPayload.class), //turn 已被新 turn 替换
    USER_MESSAGE(UserMessagePayload.class), //用户消息
    ASSISTANT_MESSAGE(AssistantMessagePayload.class), //助手消息

    TOOL_CALL_STARTED(ToolCallStartedPayload.class), //工具调用已开始
    TOOL_CALL_COMPLETED(ToolCallCompletedPayload.class), //工具调用已完成
    TOOL_CALL_FAILED(ToolCallFailedPayload.class), //工具调用失败

    //以下为运行时事件，不写入 JSONL
    ASSISTANT_MESSAGE_DELTA(AssistantMessageDeltaPayload.class), //助手文本增量，运行时事件
    ;

    private final Class<? extends SessionEventPayload> payloadClass;

    public void validatePayload(SessionEventPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException("事件 payload 不能为空: " + name());
        }
        if (!payloadClass.isInstance(payload)) {
            throw new IllegalArgumentException("事件 payload 类型不匹配: " + name());
        }
    }
}
