package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

@Schema(description = "保存工作区请求体")
public record WorkspaceCreateReq(
        @Schema(description = "工作区绝对路径")
        @NotBlank(message = "工作区路径不能为空")
        String path
) {
}
