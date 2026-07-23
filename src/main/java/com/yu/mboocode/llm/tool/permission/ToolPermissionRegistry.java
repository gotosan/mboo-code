package com.yu.mboocode.llm.tool.permission;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.common.exception.ServiceException;
import dev.langchain4j.agent.tool.Tool;
import org.springframework.stereotype.Component;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 工具权限注册表。工具注册时校验配置完整性，调用时按工具名查询。
 */
@Component
public class ToolPermissionRegistry {
    private final Map<String, ToolPermissionSpec> specs = new ConcurrentHashMap<>();

    public void register(Method method) {
        if (method == null) {
            throw new IllegalArgumentException("工具方法不能为空");
        }
        Tool tool = method.getAnnotation(Tool.class);
        if (tool == null) {
            throw new IllegalStateException("方法未标注 @Tool: " + method.getName());
        }
        ToolPermission permission = method.getAnnotation(ToolPermission.class);
        if (permission == null) {
            throw new IllegalStateException("工具未配置 @ToolPermission，禁止注册: " + method.getName());
        }

        String toolName = resolveToolName(method, tool);
        ToolPermissionType type = permission.value();
        String pathParam = StrUtil.trim(permission.pathParam());
        if (type == ToolPermissionType.READ || type == ToolPermissionType.WRITE) {
            if (StrUtil.isBlank(pathParam)) {
                throw new IllegalStateException("路径型工具必须配置 pathParam: " + toolName);
            }
        }

        ToolPermissionSpec spec = new ToolPermissionSpec(
                toolName,
                type,
                StrUtil.blankToDefault(pathParam, null),
                permission.pathKind(),
                StrUtil.trim(permission.title()),
                StrUtil.trim(permission.description())
        );
        ToolPermissionSpec existing = specs.putIfAbsent(toolName, spec);
        if (existing != null) {
            throw new IllegalStateException("重复注册工具权限: " + toolName);
        }
    }

    public ToolPermissionSpec get(String toolName) {
        ToolPermissionSpec spec = specs.get(toolName);
        if (spec == null) {
            throw new ServiceException("工具未注册权限配置: " + toolName);
        }
        return spec;
    }

    public Collection<ToolPermissionSpec> all() {
        return specs.values();
    }

    private String resolveToolName(Method method, Tool tool) {
        return StrUtil.blankToDefault(StrUtil.trim(tool.name()), method.getName());
    }
}
