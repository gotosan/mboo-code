package com.yu.mboocode.llm.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "文件分页读取结果")
public record ReadFileData(
        @Schema(description = "规范化绝对路径") String path,
        @Schema(description = "工作区相对路径") String workspaceRelativePath,
        @Schema(description = "起始行") int startLine,
        @Schema(description = "结束行") int endLine,
        @Schema(description = "总行数") int totalLines,
        @Schema(description = "带行号的文件内容") String content,
        @Schema(description = "是否截断") boolean truncated,
        @Schema(description = "下一页起始行") Integer nextOffset
) {
}
