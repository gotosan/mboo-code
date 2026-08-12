package com.yu.mboocode.agent.model;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "模型 Token 能力上限")
public record ModelLimit(
        @Schema(description = "上下文窗口 Token 上限") Long context,
        @Schema(description = "输入 Token 上限，目录未提供时为空") Long input,
        @Schema(description = "输出 Token 上限") Long output
) {
}
