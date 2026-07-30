package com.yu.mboocode.agent.tool.permission;

/**
 * 单次工具权限评估结果：状态、错误码与错误信息。
 */
public record PermissionCheck(CheckStatus status, ToolPermissionErrorCode errorCode, String message) {
    /** 构造成功放行结果（无路径）。 */
    public static PermissionCheck allowed() {
        return new PermissionCheck(CheckStatus.ALLOWED, null, null);
    }

    /** 构造需要用户授权结果（无路径）。 */
    public static PermissionCheck needAsk() {
        return new PermissionCheck(CheckStatus.NEED_ASK, null, null);
    }

    /** 构造评估失败结果（参数/配置/路径等硬错误，不发起用户授权）。 */
    public static PermissionCheck error(ToolPermissionErrorCode errorCode, String message) {
        return new PermissionCheck(CheckStatus.ERROR, errorCode, message);
    }

    /**
     * 权限评估结果状态。
     */
    public enum CheckStatus {
        /** 已满足权限，可直接执行。 */
        ALLOWED,
        /** 需要向用户弹窗授权。 */
        NEED_ASK,
        /** 评估失败，无法发起授权。 */
        ERROR
    }
}
