package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "网页抓取结果")
public record WebFetchData(
        @Schema(description = "脱敏后的请求 URL") String requestedUrl,
        @Schema(description = "脱敏后的最终 URL") String finalUrl,
        @Schema(description = "结果格式") String format,
        @Schema(description = "响应内容类型") String contentType,
        @Schema(description = "解码字符集") String charset,
        @Schema(description = "本页起始行") int startLine,
        @Schema(description = "本页结束行") int endLine,
        @Schema(description = "转换后的总行数") int totalLines,
        @Schema(description = "本页内容") String content,
        @Schema(description = "是否还有未返回内容") boolean truncated,
        @Schema(description = "下一页起始行") Integer nextOffset,
        @Schema(description = "重定向次数") int redirectCount,
        @Schema(description = "抓取时间") String fetchedAt,
        @Schema(description = "耗时毫秒数") long durationMs,
        @Schema(description = "解码是否发生替换降级") boolean encodingWarning
) {
}
