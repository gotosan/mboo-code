package com.yu.mboocode.agent.subagent;

import com.baomidou.mybatisplus.annotation.*;
import com.yu.mboocode.agent.model.ContextUsageSnapshot;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

@Data
@TableName("mboo_subagent_runs")
@Schema(description = "一次子 Agent 委派执行；终态必须在资源清理完成后发布")
public class SubagentRun {
    @TableId(type = IdType.INPUT)
    @Schema(description = "执行 ID")
    private String runId;
    @Schema(description = "子会话 ID")
    private String agentId;
    @Schema(description = "父会话 ID")
    private String parentSessionId;
    @Schema(description = "父执行轮次")
    private String parentTurnId;
    @Schema(description = "父助手消息")
    private String parentMessageId;
    @Schema(description = "创建或继续工具调用")
    private String parentToolCallId;
    @Schema(description = "幂等键")
    private String invocationKey;
    @Schema(description = "真实子 turn")
    private String childTurnId;
    @Schema(description = "角色")
    private String role;
    @Schema(description = "前后台模式")
    private String mode;
    @Schema(description = "模型")
    private String modelId;
    @Schema(description = "推理配置")
    private String reasoningEffort;
    @Schema(description = "状态")
    private Status status;
    @Schema(description = "单调递增展示版本")
    private long version;
    @Schema(description = "受理时间")
    private String createdAt;
    @Schema(description = "更新时间")
    private String updatedAt;
    @Schema(description = "结束时间")
    private String finishedAt;
    @Schema(description = "完整结果制品 ID")
    private String resultId;
    @Schema(description = "结果摘要")
    private String finalText;
    @Schema(description = "错误码")
    private String errorCode;
    @Schema(description = "错误说明")
    private String errorMessage;
    @Schema(description = "累计真实模型请求用量 JSON，缺失为空")
    private String usage;
    @Schema(description = "已随父模型请求提交的结果工具调用")
    private String deliveryToolCallId;

    public boolean terminal() { return status != null && status.terminal(); }

    @Schema(description = "子执行状态")
    public enum Status {
        STARTING, RUNNING, WAITING_APPROVAL, FINALIZING, CANCELLING, SUCCEEDED, FAILED, CANCELLED, INTERRUPTED;
        public boolean terminal() { return this == SUCCEEDED || this == FAILED || this == CANCELLED || this == INTERRUPTED; }
    }
}
