package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * turn 失败事件主体。
 */
@Schema(description = "turn 失败事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TurnFailedPayload implements SessionEventPayload {
    @Schema(description = "错误编码")
    private String errorCode;

    @Schema(description = "错误信息")
    private String errorMessage;

    @Schema(description = "本轮耗时，单位毫秒")
    private Long durationMs;
}
