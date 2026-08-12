package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "工作区目录选择结果")
public record WorkspaceSelectResp(
        @Schema(description = "工作区绝对路径，取消选择时为空")
        String workspacePath
) {}
