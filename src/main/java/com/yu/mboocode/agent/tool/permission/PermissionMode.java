package com.yu.mboocode.agent.tool.permission;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.common.enums.CodeEnum;

/**
 * 会话权限模式。存储在 Sessions.metadataJson 顶层 permissionMode 字段。
 */
public enum PermissionMode implements CodeEnum {
    /** 默认权限：NEED_ASK 时弹授权卡片等待用户决策 */
    DEFAULT,
    /** 完全访问：NEED_ASK 自动放行，ERROR 与内置命令黑名单照常拒绝 */
    FULL_ACCESS;

    @Override
    public String getCode() {
        return name();
    }

    /** 缺失或非法值按默认权限处理，兼容历史会话。 */
    public static PermissionMode fromCode(String code) {
        if (StrUtil.isBlank(code)) {
            return DEFAULT;
        }
        for (PermissionMode mode : values()) {
            if (mode.name().equals(code)) {
                return mode;
            }
        }
        return DEFAULT;
    }
}