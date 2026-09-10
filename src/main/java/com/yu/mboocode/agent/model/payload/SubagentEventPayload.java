package com.yu.mboocode.agent.model.payload;

import com.yu.mboocode.agent.model.SessionEvent;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "父 SSE 转发子事件，不写父 JSONL")
public record SubagentEventPayload(@Schema(description = "子会话") String agentId, @Schema(description = "子执行") String runId,
                                  @Schema(description = "保留真实身份的原始子事件") SessionEvent childEvent) implements SessionEventPayload {}
