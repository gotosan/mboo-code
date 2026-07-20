package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "会话更新请求体")
public record SessionUpdateReq(
        @Schema(description = "会话标题")
        @NotBlank(message = "会话标题不能为空")
        String title
) {
}
