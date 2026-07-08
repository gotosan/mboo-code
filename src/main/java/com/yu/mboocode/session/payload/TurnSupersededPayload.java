package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * turn 被替换事件主体。
 */
@Schema(description = "turn 被替换事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TurnSupersededPayload implements SessionEventPayload {
    @Schema(description = "替换后的 turn ID")
    private String supersededByTurnId;

    @Schema(description = "替换原因")
    private String reason;

    @Schema(description = "是否在普通视图隐藏旧 turn")
    private Boolean hiddenInNormalView;
}
