package com.yu.mboocode.session.model;

import com.yu.mboocode.session.enums.SessionEventSource;
import com.yu.mboocode.session.enums.SessionEventType;
import com.yu.mboocode.session.payload.SessionEventPayload;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Data;

import java.util.Map;

/**
 * JSONL 中单行会话事件的统一信封。
 */
@Schema(description = "会话事件")
@Data
@Builder
public class SessionEvent {
    @Schema(description = "事件唯一 ID")
    private String eventId;

    @Schema(description = "会话 ID")
    private String sessionId;

    @Schema(description = "当前 turn ID，session 级事件可为空")
    private String turnId;

    @Schema(description = "事件类型")
    private SessionEventType type;

    @Schema(description = "事件来源")
    private SessionEventSource source;

    @Schema(description = "事件创建时间，UTC ISO-8601 字符串")
    private String createdAt;

    @Schema(description = "事件主体，结构由事件类型决定")
    private SessionEventPayload payload;

    @Schema(description = "事件扩展元数据")
    private Map<String, Object> meta;
}
