package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@Schema(description = "ask 问题页答案")
public record AskAnswerReq(
        @Schema(description = "问题页索引，从 0 开始") @NotNull Integer pageIndex,
        @Schema(description = "答案动作：ANSWER 或 SKIP") @NotBlank String action,
        @Schema(description = "答案文本，SKIP 时不传") String text,
        @Schema(description = "客户端幂等 ID") @NotBlank String actionId
) {}
