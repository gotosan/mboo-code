package com.yu.mboocode.agent.model.payload;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "子授权阶段实时更新，不恢复历史审批")
public record SubagentApprovalUpdatedPayload(@Schema(description = "子会话") String agentId, @Schema(description = "执行") String runId,
                                            @Schema(description = "审批阶段") String approvalId, @Schema(description = "真实子轮次") String turnId,
                                            @Schema(description = "真实子调用") String toolCallId, @Schema(description = "是否仍待处理") boolean pending) implements SessionEventPayload {}
