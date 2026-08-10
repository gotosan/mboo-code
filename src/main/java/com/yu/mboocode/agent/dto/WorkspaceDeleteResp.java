package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "工作区删除结果")
public record WorkspaceDeleteResp(
        @Schema(description = "永久删除的下属会话数量") int deletedSessionCount
) {
}
