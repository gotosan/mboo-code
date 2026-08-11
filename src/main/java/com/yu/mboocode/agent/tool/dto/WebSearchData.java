package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "网络搜索结果")
public record WebSearchData(
        @Schema(description = "查询文本") String query,
        @Schema(description = "搜索供应商") String provider,
        @Schema(description = "是否成功解析为结构化结果") boolean structured,
        @Schema(description = "结构化结果") List<WebSearchResult> results,
        @Schema(description = "供应商非标准原文") String providerContent,
        @Schema(description = "结果数量") int resultCount,
        @Schema(description = "结果是否被裁剪") boolean truncated,
        @Schema(description = "耗时毫秒数") long durationMs
) {
    public WebSearchData {
        results = results == null ? List.of() : List.copyOf(results);
    }
}
