package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 助手消息增量事件主体。
 */
@Schema(description = "助手消息增量事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssistantMessageDeltaPayload implements SessionEventPayload {
    @Schema(description = "消息 ID")
    private String messageId;

    @Schema(description = "增量文本")
    private String text;
}
