package com.yu.mboocode.session.payload;

import com.yu.mboocode.common.enums.CodeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.*;

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

    @Schema(description = "消息状态")
    private AssistantMessageState state;

    @Schema(description = "消息文本")
    private String text;

    @Schema(description = "错误信息")
    private String errorMessage;

    @Schema(description = "本轮耗时，单位毫秒")
    private Long durationMs;

    @AllArgsConstructor
    @Getter
    public enum AssistantMessageState implements CodeEnum {
        COMPLETE("complete"),
        CANCEL("cancel"),
        ERROR("error"),
        ;
        private final String code;
    }
}
