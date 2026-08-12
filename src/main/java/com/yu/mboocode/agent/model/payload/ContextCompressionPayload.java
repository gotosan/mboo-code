package com.yu.mboocode.agent.model.payload;

import com.yu.mboocode.agent.model.ContextUsageSnapshot;
import com.yu.mboocode.common.enums.CodeEnum;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 上下文压缩事件主体。
 *
 * <p>同一次压缩使用相同 compressionId 写入多条状态事件，前端按 compressionId 归并。
 * 不保存摘要正文、原始历史消息、工具输出或 diff；Token 字段为内部估算，仅用于诊断。</p>
 */
@Schema(description = "上下文压缩事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ContextCompressionPayload implements SessionEventPayload {
    @Schema(description = "压缩 ID，同一次压缩的多条状态事件共用")
    private String compressionId;

    @Schema(description = "触发方式：auto 自动、manual 主动")
    private Trigger trigger;

    @Schema(description = "压缩状态：started、completed、failed、skipped")
    private State state;

    @Schema(description = "实际选择的摘要模型 ID")
    private String modelId;

    @Schema(description = "压缩前已存在的真实对话 usage，不保存摘要模型 usage")
    private ContextUsageSnapshot previousUsage;

    @Schema(description = "产生 previousUsage 时模型的上下文窗口")
    private Long previousContextLimit;

    @Schema(description = "本次并入摘要的历史对话 turn 数")
    private Integer summarizedTurnCount;

    @Schema(description = "本次压缩后完整保留的历史对话 turn 数")
    private Integer retainedTurnCount;

    @Schema(description = "本次改写为结论版的工具调用数")
    private Integer compactedToolCallCount;

    @Schema(description = "压缩前 ChatMemory 消息数")
    private Integer beforeMessageCount;

    @Schema(description = "压缩后 ChatMemory 消息数")
    private Integer afterMessageCount;

    @Schema(description = "压缩前内部 Token 估算，仅用于诊断")
    private Long beforeEstimatedTokens;

    @Schema(description = "压缩后内部 Token 估算，仅用于诊断")
    private Long afterEstimatedTokens;

    @Schema(description = "压缩耗时，单位毫秒")
    private Long durationMs;

    @Schema(description = "跳过原因，仅 skipped 时填写")
    private String skipReason;

    @Schema(description = "适合用户展示的安全错误信息，仅 failed 时填写")
    private String errorMessage;

    @Schema(description = "压缩触发方式")
    @Getter
    @AllArgsConstructor
    public enum Trigger implements CodeEnum {
        AUTO("auto"), //自动触发
        MANUAL("manual"), //用户主动触发
        ;
        private final String code;
    }

    @Schema(description = "压缩状态")
    @Getter
    @AllArgsConstructor
    public enum State implements CodeEnum {
        STARTED("started"), //已开始
        COMPLETED("completed"), //已完成
        FAILED("failed"), //已失败
        SKIPPED("skipped"), //无可压缩内容，未调用模型
        ;
        private final String code;
    }
}
