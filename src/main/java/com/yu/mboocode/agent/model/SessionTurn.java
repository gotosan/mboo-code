package com.yu.mboocode.agent.model;

import com.yu.mboocode.agent.enums.TurnOperationType;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 当前请求对应的执行 turn 上下文。
 */
@Schema(description = "执行 turn 上下文")
public record SessionTurn(
        @Schema(description = "会话 ID")
        String sessionId,

        @Schema(description = "会话 JSONL 文件路径或相对 URI")
        String transcriptUri,

        @Schema(description = "会话工作区绝对路径")
        String workspacePath,

        @Schema(description = "本轮执行 turn ID")
        String turnId,

        @Schema(description = "本轮执行 turn 开始时间")
        Long startNano,

        @Schema(description = "执行 turn 操作类型")
        TurnOperationType operationType
) {
    public SessionTurn(String sessionId, String transcriptUri, String turnId, Long startNano) {
        this(sessionId, transcriptUri, null, turnId, startNano, TurnOperationType.CHAT);
    }
}
