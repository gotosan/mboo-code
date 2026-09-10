package com.yu.mboocode.agent.model.payload;

import com.yu.mboocode.agent.subagent.SubagentRun;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "子执行持久状态，以 runId 和 version 归并")
public record SubagentRunUpdatedPayload(@Schema(description = "父助手消息") String messageId, @Schema(description = "执行记录") SubagentRun run) implements SessionEventPayload {}
