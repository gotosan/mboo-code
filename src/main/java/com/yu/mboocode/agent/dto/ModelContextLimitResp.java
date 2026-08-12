package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "模型上下文窗口上限配置")
public record ModelContextLimitResp(
        @Schema(description = "供应商实际模型 ID") String modelId,
        @Schema(description = "当前模型可调下限") Long minimumContextLimit,
        @Schema(description = "models.dev 模型能力上限") Long maximumContextLimit,
        @Schema(description = "数据库保存的原始偏好，没有偏好时为空") Long configuredContextLimit,
        @Schema(description = "当前实际生效的上下文窗口上限") Long effectiveContextLimit,
        @Schema(description = "当前模型是否存在可调范围") boolean adjustable
) {
}
