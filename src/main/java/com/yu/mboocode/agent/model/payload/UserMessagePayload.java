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

    @Schema(description = "本条消息使用的模型名称，旧会话事件可为空")
    private String modelName;
}
