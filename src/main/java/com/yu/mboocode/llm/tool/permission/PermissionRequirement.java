package com.yu.mboocode.llm.tool.permission;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "单个工具权限要求")
public record PermissionRequirement(
        @Schema(description = "权限类型") ToolPermissionType permissionType,
        @Schema(description = "规范化授权目录") String grantPath,
        @Schema(description = "内部授权范围值") String grantValue,
        @Schema(description = "授权标题") String title,
        @Schema(description = "授权说明") String description,
        @Schema(description = "当前评估结果") PermissionCheck check
) {
    public boolean sameScope(PermissionRequirement other) {
        return other != null && permissionType == other.permissionType
                && java.util.Objects.equals(grantPath, other.grantPath)
                && java.util.Objects.equals(grantValue, other.grantValue);
    }
}
