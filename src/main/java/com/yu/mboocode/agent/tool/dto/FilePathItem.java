package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "文件路径信息")
public record FilePathItem(
        @Schema(description = "规范化绝对路径") String path,
        @Schema(description = "工作区相对路径") String workspaceRelativePath
) {
}
