package com.yu.mboocode.agent.tool.permission;

import com.yu.mboocode.common.enums.CodeEnum;

/**
 * 工具权限类型。每个工具必须显式配置其中一种。
 */
public enum ToolPermissionType implements CodeEnum {
    /** 无需授权 */
    NONE,
    /** 按工具名称授权 */
    TOOL,
    /** 读取指定目录及其子目录 */
    READ,
    /** 读写指定目录及其子目录，包含 READ */
    WRITE,
    /** 执行符合规则或会话精确授权的 Shell 命令 */
    COMMAND,
    /** 访问一个经过规范化和安全分类的私有网络来源 */
    NETWORK;

    @Override
    public String getCode() {
        return name();
    }
}
