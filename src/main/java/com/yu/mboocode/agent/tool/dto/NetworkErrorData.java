package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "网络工具错误详情")
public record NetworkErrorData(
        @Schema(description = "HTTP 状态码") Integer statusCode,
        @Schema(description = "脱敏后的请求 URL") String requestedUrl,
        @Schema(description = "脱敏后的最终 URL") String finalUrl,
        @Schema(description = "需要直接重新抓取的脱敏重定向 URL") String redirectUrl,
        @Schema(description = "是否适合重试") boolean retryable,
        @Schema(description = "建议等待秒数") Long retryAfterSeconds
) {
}
