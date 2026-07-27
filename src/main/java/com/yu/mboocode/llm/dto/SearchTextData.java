package com.yu.mboocode.llm.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "文本搜索结果")
public record SearchTextData(
        @Schema(description = "匹配结果") List<SearchTextMatch> matches,
        @Schema(description = "匹配行数") int matchCount,
        @Schema(description = "匹配文件数") int fileCount,
        @Schema(description = "跳过的二进制文件数") int skippedBinaryFiles,
        @Schema(description = "跳过的编码文件数") int skippedEncodingFiles,
        @Schema(description = "跳过的大文件数") int skippedLargeFiles,
        @Schema(description = "跳过的忽略文件数") int skippedIgnoredFiles,
        @Schema(description = "是否截断") boolean truncated
) {
}
