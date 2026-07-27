package com.yu.mboocode.llm.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "文本搜索单条匹配")
public record SearchTextMatch(
        @Schema(description = "规范化绝对路径") String path,
        @Schema(description = "工作区相对路径") String workspaceRelativePath,
        @Schema(description = "行号") int lineNumber,
        @Schema(description = "匹配行文本") String lineText,
        @Schema(description = "匹配起始位置") int matchStart,
        @Schema(description = "匹配结束位置") int matchEnd
) {
}
