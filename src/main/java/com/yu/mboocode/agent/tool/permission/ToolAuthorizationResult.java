package com.yu.mboocode.agent.tool.permission;

import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 工具授权等待结果，区分允许、用户拒绝与授权超时。
 */
@Schema(description = "工具授权等待结果")
public record ToolAuthorizationResult(
        @Schema(description = "是否允许执行")
        boolean allowed,

        @Schema(description = "用户决策，预授权时可能为空")
        ToolApprovalDecision decision,

        @Schema(description = "错误码")
        ToolPermissionErrorCode errorCode,

        @Schema(description = "错误说明")
        String message,

        @Schema(description = "本次权限类型")
        ToolPermissionType permissionType,

        @Schema(description = "申请授权的规范化目录，仅路径型权限使用")
        String grantPath
) {
    public static ToolAuthorizationResult allow(ToolApprovalDecision decision, ToolPermissionType permissionType, String grantPath) {
        return new ToolAuthorizationResult(true, decision, null, null, permissionType, grantPath);
    }

    public static ToolAuthorizationResult denied(ToolPermissionType permissionType, String grantPath) {
        return error(ToolPermissionErrorCode.PERMISSION_DENIED, "用户拒绝了本次工具调用", permissionType, grantPath);
    }

    public static ToolAuthorizationResult timeout(ToolPermissionType permissionType, String grantPath) {
        return error(ToolPermissionErrorCode.PERMISSION_TIMEOUT, "工具授权超时", permissionType, grantPath);
    }

    public static ToolAuthorizationResult error(ToolPermissionErrorCode errorCode, String message, ToolPermissionType permissionType, String grantPath) {
        return new ToolAuthorizationResult(false, ToolApprovalDecision.DENY, errorCode, message, permissionType, grantPath);
    }
}
