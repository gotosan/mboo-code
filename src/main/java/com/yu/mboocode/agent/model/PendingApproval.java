package com.yu.mboocode.agent.model;

import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.concurrent.CompletableFuture;

/**
 * 等待用户处理的工具授权上下文，用于关联授权接口、会话工具调用和被阻塞的执行线程。
 */
@Schema(description = "待处理的工具授权上下文")
public record PendingApproval(
        @Schema(description = "授权请求 ID")
        String approvalId,

        @Schema(description = "会话 ID")
        String sessionId,

        @Schema(description = "本轮 turn ID")
        String turnId,

        @Schema(description = "工具名称")
        String toolName,

        @Schema(description = "权限类型")
        ToolPermissionType permissionType,

        @Schema(description = "申请授权的规范化目录，仅 READ/WRITE 使用")
        String grantPath,

        @Schema(description = "内部授权范围值，例如命令指纹")
        String grantValue,

        @Schema(description = "当前授权阶段，从 1 开始")
        int approvalIndex,

        @Schema(description = "授权阶段总数")
        int approvalCount,

        @Schema(hidden = true)
        int requirementIndex,

        @Schema(hidden = true)
        CompletableFuture<ToolApprovalDecision> future
) {
}
