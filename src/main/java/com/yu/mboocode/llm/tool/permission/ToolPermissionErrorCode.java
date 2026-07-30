package com.yu.mboocode.llm.tool.permission;

import com.yu.mboocode.llm.tool.ToolErrorCode;

/**
 * 工具权限相关错误码。
 */
public enum ToolPermissionErrorCode implements ToolErrorCode {
    /** 用户拒绝本次工具调用 */
    PERMISSION_DENIED,
    /** 等待用户授权超时 */
    PERMISSION_TIMEOUT,
    /** 路径参数缺失、格式错误或无法解析授权目录 */
    PERMISSION_INVALID_PATH,
    /** 工具配置了未知的权限类型 */
    PERMISSION_UNKNOWN_TYPE,
    /** 授权等待被中断 */
    PERMISSION_INTERRUPTED,
    /** 授权处理过程出现未分类错误 */
    PERMISSION_ERROR,
    /** 执行前复核发现路径与授权时不一致 */
    PERMISSION_PATH_CHANGED,
    /** 会话级授权已不满足当前路径 */
    PERMISSION_REVOKED,
    /** 内置命令规则明确禁止命令 */
    COMMAND_PERMISSION_DENIED,
    /** 执行前命令身份与授权时不一致 */
    COMMAND_PERMISSION_CHANGED;

    @Override
    public String getCode() {
        return name();
    }
}
