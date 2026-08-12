package com.yu.mboocode.agent.tool.permission;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 已解析的工具权限规格。
 */
@Schema(description = "工具权限规格")
public record ToolPermissionSpec(
        @Schema(description = "工具名称")
        String toolName,

        @Schema(description = "权限类型")
        ToolPermissionType permissionType,

        @Schema(description = "路径参数名，仅 READ/WRITE 使用")
        String pathParam,

        @Schema(description = "路径参数语义")
        PathKind pathKind,

        @Schema(description = "授权标题")
        String title,

        @Schema(description = "授权说明")
        String description
) {
}
