package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "网络搜索单条结果")
public record WebSearchResult(
        @Schema(description = "标题") String title,
        @Schema(description = "来源 URL") String url,
        @Schema(description = "发布日期") String publishedDate,
        @Schema(description = "作者") String author,
        @Schema(description = "摘要") String snippet
) {
}
