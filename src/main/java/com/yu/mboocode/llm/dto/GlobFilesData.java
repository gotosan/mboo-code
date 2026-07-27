package com.yu.mboocode.llm.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "文件查找结果")
public record GlobFilesData(
        @Schema(description = "匹配文件") List<FilePathItem> files,
        @Schema(description = "结果数量") int count,
        @Schema(description = "是否截断") boolean truncated
) {
}
