package com.yu.mboocode.agent.model.payload;

import com.yu.mboocode.common.enums.CodeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 工具调用结束事件主体。
 */
@Schema(description = "工具调用结束事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolCallEndedPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用参数 JSON 字符串")
    private String arguments;

    @Schema(description = "工具调用结束状态")
    private ToolCallStatus status;

    @Schema(description = "工具结果 ID")
    private String resultId;

    @Schema(description = "工具结果 UTF-8 字节数")
    private Long resultSizeBytes;

    @Schema(description = "是否存在命令原始输出")
    private Boolean rawOutputAvailable;

    @Schema(description = "错误编码，成功时为空")
    private String errorCode;

    @Schema(description = "错误信息，成功时为空")
    private String errorMessage;

    @Schema(description = "工具调用耗时，单位毫秒")
    private Long durationMs;

    @Schema(description = "ask 按问题页顺序保存的最终答案")
    private List<String> askAnswers;

    @AllArgsConstructor
    @Getter
    public enum ToolCallStatus implements CodeEnum {
        COMPLETED("completed"),
        FAILED("failed"),
        ;
        private final String code;
    }
}
