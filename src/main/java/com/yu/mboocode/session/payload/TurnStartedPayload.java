package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * turn 开始事件主体。
 */
@Schema(description = "turn 开始事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TurnStartedPayload implements SessionEventPayload {
    @Schema(description = "触发方式，例如 user、retry、resume")
    private String trigger;

    @Schema(description = "本轮用户消息 ID")
    private String userMessageId;
}
