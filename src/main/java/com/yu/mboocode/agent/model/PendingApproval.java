package com.yu.mboocode.agent.model;

import com.yu.mboocode.agent.enums.ToolApprovalDecision;
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

        @Schema(hidden = true)
        CompletableFuture<ToolApprovalDecision> future,

        @Schema(hidden = true)
        Runnable toolStartedEmitter
) {
}
