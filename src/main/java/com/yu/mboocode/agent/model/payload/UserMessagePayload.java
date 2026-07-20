package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户消息事件主体。
 */
@Schema(description = "用户消息事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserMessagePayload implements SessionEventPayload {
    @Schema(description = "消息 ID")
    private String messageId;

    @Schema(description = "消息文本")
    private String text;
}
