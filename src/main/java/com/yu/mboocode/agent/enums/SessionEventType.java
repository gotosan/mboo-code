package com.yu.mboocode.agent.enums;

import com.yu.mboocode.agent.model.payload.AssistantMessageDeltaPayload;
import com.yu.mboocode.agent.model.payload.AssistantMessagePayload;
import com.yu.mboocode.agent.model.payload.CancelledPayload;
import com.yu.mboocode.agent.model.payload.ContextUsageUpdatedPayload;
import com.yu.mboocode.agent.model.payload.ErrorPayload;
import com.yu.mboocode.agent.model.payload.SessionEventPayload;
import com.yu.mboocode.agent.model.payload.ToolApprovalRequiredPayload;
import com.yu.mboocode.agent.model.payload.ToolCallEndedPayload;
import com.yu.mboocode.agent.model.payload.ToolCallStartedPayload;
import com.yu.mboocode.agent.model.payload.UserMessagePayload;
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 会话事件类型
 */
@Getter
@AllArgsConstructor
public enum SessionEventType {
    USER_MESSAGE(UserMessagePayload.class, true), //用户消息
    ASSISTANT_MESSAGE(AssistantMessagePayload.class, true), //助手消息

    TOOL_CALL_STARTED(ToolCallStartedPayload.class, true), //工具调用已开始
    TOOL_CALL_ENDED(ToolCallEndedPayload.class, true), //工具调用已结束
    TOOL_APPROVAL_REQUIRED(ToolApprovalRequiredPayload.class, true), //工具等待用户授权

    ERROR(ErrorPayload.class, true), //会话执行错误
    CANCELLED(CancelledPayload.class, true), //会话已取消

    //以下为运行时事件，不写入 JSONL
    ASSISTANT_MESSAGE_DELTA(AssistantMessageDeltaPayload.class, false), //助手文本增量，运行时事件
    CONTEXT_USAGE_UPDATED(ContextUsageUpdatedPayload.class, false), //上下文用量更新，运行时事件
    ;

    private final Class<? extends SessionEventPayload> payloadClass;
    private final boolean persistent;

    public void validatePayload(SessionEventPayload payload) {
        if (payload == null) {
            throw new IllegalArgumentException("事件 payload 不能为空: " + name());
        }
        if (!payloadClass.isInstance(payload)) {
            throw new IllegalArgumentException("事件 payload 类型不匹配: " + name());
        }
    }
}
