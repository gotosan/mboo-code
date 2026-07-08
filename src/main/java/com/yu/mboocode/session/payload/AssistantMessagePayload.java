package com.yu.mboocode.session.payload;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 助手消息事件主体。
 */
@Schema(description = "助手消息事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssistantMessagePayload implements SessionEventPayload {
    @Schema(description = "消息 ID")
    private String messageId;

    @Schema(description = "消息状态：completed 已完成、interrupted 已中断")
    private String state;

    @Schema(description = "消息文本")
    private String text;

    @Schema(description = "完成原因，完成状态时使用")
    private String finishReason;

    @Schema(description = "中断原因，中断状态时使用")
    private String reason;

    @Schema(description = "错误信息，中断状态可能存在")
    private String errorMessage;

    @Schema(description = "本轮耗时，单位毫秒")
    private Long durationMs;
}
