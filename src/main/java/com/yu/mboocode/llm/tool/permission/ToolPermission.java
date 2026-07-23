package com.yu.mboocode.llm.tool.permission;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 工具权限配置。遗漏时在工具注册阶段直接失败，避免绕过权限检查。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ToolPermission {
    ToolPermissionType value();

    /** READ/WRITE 必填：路径参数名称，例如 path */
    String pathParam() default "";

    /** 路径参数表示文件还是目录 */
    PathKind pathKind() default PathKind.FILE;

    /** 授权卡片标题，空则按权限类型生成默认文案 */
    String title() default "";

    /** 授权卡片说明，空则按权限类型生成默认文案 */
    String description() default "";
}
