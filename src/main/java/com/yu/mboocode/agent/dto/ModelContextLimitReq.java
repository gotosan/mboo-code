package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "模型上下文窗口上限更新请求")
public record ModelContextLimitReq(
        @Schema(description = "上下文窗口 Token 上限")
        @NotNull(message = "上下文上限不能为空")
        Long contextLimit
) {
}
