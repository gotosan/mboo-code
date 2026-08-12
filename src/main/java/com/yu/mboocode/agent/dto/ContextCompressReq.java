package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "主动上下文压缩请求体")
public record ContextCompressReq(
        @Schema(description = "可选的当前 UI 模型 ID，仅作为上一轮模型不可用时的后备摘要模型")
        String modelName
) {
}
