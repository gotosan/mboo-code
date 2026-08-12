package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "文件修改摘要")
public record FileChangeData(
        @Schema(description = "操作类型") String operation,
        @Schema(description = "规范化绝对路径") String path,
        @Schema(description = "工作区相对路径") String workspaceRelativePath,
        @Schema(description = "新增行数") int addedLines,
        @Schema(description = "删除行数") int deletedLines,
        @Schema(description = "修改前字节数") long beforeBytes,
        @Schema(description = "修改后字节数") long afterBytes,
        @Schema(description = "替换次数，仅编辑工具使用") Integer replacements,
        @Schema(description = "Unified diff") String diff,
        @Schema(description = "Diff 是否截断") boolean diffTruncated
) {
}
