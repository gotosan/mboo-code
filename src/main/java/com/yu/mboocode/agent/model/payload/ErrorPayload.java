package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 会话错误事件主体。
 */
@Schema(description = "会话错误事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ErrorPayload implements SessionEventPayload {
    @Schema(description = "错误信息")
    private String errorMessage;

    @Schema(description = "本轮耗时，单位毫秒")
    private Long durationMs;
}
