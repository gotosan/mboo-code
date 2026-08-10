package com.yu.mboocode.agent.dto;

import com.yu.mboocode.agent.tool.permission.PermissionMode;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "会话权限模式修改请求体")
public record SessionPermissionModeReq(
        @Schema(description = "权限模式：DEFAULT 默认权限、FULL_ACCESS 完全访问")
        @NotNull(message = "权限模式不能为空")
        PermissionMode mode
) {}