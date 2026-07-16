package com.yu.mboocode.session.enums;

import com.yu.mboocode.session.payload.AssistantMessageDeltaPayload;
import com.yu.mboocode.session.payload.AssistantMessagePayload;
import com.yu.mboocode.session.payload.CancelledPayload;
import com.yu.mboocode.session.payload.ErrorPayload;
import com.yu.mboocode.session.payload.SessionEventPayload;
import com.yu.mboocode.session.payload.ToolCallCompletedPayload;
import com.yu.mboocode.session.payload.ToolCallFailedPayload;
import com.yu.mboocode.session.payload.ToolCallStartedPayload;
import com.yu.mboocode.session.payload.UserMessagePayload;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 会话事件类型
 */
@Getter
@AllArgsConstructor
public enum SessionEventType {
    USER_MESSAGE(UserMessagePayload.class), //用户消息
    ASSISTANT_MESSAGE(AssistantMessagePayload.class), //助手消息

    TOOL_CALL_STARTED(ToolCallStartedPayload.class), //工具调用已开始
    TOOL_CALL_COMPLETED(ToolCallCompletedPayload.class), //工具调用已完成
    TOOL_CALL_FAILED(ToolCallFailedPayload.class), //工具调用失败

    ERROR(ErrorPayload.class), //会话执行错误
    CANCELLED(CancelledPayload.class), //会话已取消

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
