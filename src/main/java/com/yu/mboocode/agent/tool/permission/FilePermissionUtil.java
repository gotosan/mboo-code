package com.yu.mboocode.agent.tool.permission;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.common.exception.ServiceException;
import lombok.experimental.UtilityClass;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 路径型权限的严格路径解析与包含关系校验。
 * 使用 Path.startsWith 判断目录包含关系，并对真实路径做符号链接/Junction 防护。
 */
@UtilityClass
public class FilePermissionUtil {
    public static final int MAX_PATH_LENGTH = 4096;
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    private static final Set<String> WINDOWS_RESERVED_NAMES = Set.of("CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9");

    /**
     * 解析工具参数路径为规范化绝对路径；相对路径以会话工作区为基准。
     */
    public static Path resolveAbsolutePath(String workspacePath, String rawPath) {
        if (StrUtil.isBlank(rawPath)) {
            throw new ServiceException("路径不能为空");
        }
        if (rawPath.length() > MAX_PATH_LENGTH) {
            throw new ServiceException("路径长度不能超过 " + MAX_PATH_LENGTH + " 个字符");
        }
        validateSystemPath(rawPath);
        if (StrUtil.isBlank(workspacePath)) {
            throw new ServiceException("会话工作区未设置");
        }

        try {
            Path path = Path.of(rawPath.trim());
            if (!path.isAbsolute()) {
                path = Path.of(workspacePath).resolve(path);
            }
            return path.toAbsolutePath().normalize();
        } catch (InvalidPathException e) {
            throw new ServiceException("路径格式错误");
        }
    }

    /**
     * 计算本次申请授权的目录：文件参数取父目录，目录参数取自身。
     */
    public static Path resolveGrantDirectory(String workspacePath, String rawPath, PathKind pathKind) {
        Path absolute = resolveAbsolutePath(workspacePath, rawPath);
        Path secureTarget = toSecurePath(absolute);
        Path grantDir = pathKind == PathKind.FILE ? secureTarget.getParent() : secureTarget;
        if (grantDir == null) {
            throw new ServiceException("无法解析授权目录");
        }
        return toSecurePath(grantDir);
    }

    /**
     * 将路径转换为可用于权限比较的真实路径。
     * 已存在路径直接 realPath；不存在时从最近已存在父目录 realPath 再拼接剩余段。
     */
    public static Path toSecurePath(Path path) {
        Path absolute = path.toAbsolutePath().normalize();
        try {
            if (Files.exists(absolute)) {
                return absolute.toRealPath();
            }

            List<String> missing = new ArrayList<>();
            Path cursor = absolute;
            while (cursor != null && !Files.exists(cursor)) {
                Path name = cursor.getFileName();
                if (name != null) {
                    missing.addFirst(name.toString());
                }
                cursor = cursor.getParent();
            }
            if (cursor == null) {
                throw new ServiceException("无法解析路径");
            }

            Path realBase = cursor.toRealPath();
            Path resolved = realBase;
            for (String segment : missing) {
                resolved = resolved.resolve(segment);
            }
            return resolved.normalize();
        } catch (IOException e) {
            throw new ServiceException("无法解析路径");
        }
    }

    /**
     * 判断 child 是否位于 parent 目录下（含自身）。
     */
    public static boolean isUnder(Path child, Path parent) {
        if (child == null || parent == null) {
            return false;
        }
        Path secureChild = toSecurePath(child);
        Path secureParent = toSecurePath(parent);
        return secureChild.startsWith(secureParent);
    }

    /**
     * 判断目标目录是否被任一授权目录覆盖。
     */
    public static boolean isCoveredByAny(Path targetDir, Iterable<String> authorizedDirs) {
        if (targetDir == null || authorizedDirs == null) {
            return false;
        }
        for (String authorized : authorizedDirs) {
            if (StrUtil.isBlank(authorized)) {
                continue;
            }
            try {
                if (isUnder(targetDir, Path.of(authorized))) {
                    return true;
                }
            } catch (InvalidPathException | ServiceException ignored) {
                // 历史坏数据忽略，不授予权限
            }
        }
        return false;
    }

    public static String toStoredPath(Path path) {
        return toSecurePath(path).toString();
    }

    public static String workspaceRelativePath(Path target, Path workspace) {
        Path secureTarget = toSecurePath(target);
        Path secureWorkspace = toSecurePath(workspace);
        if (!secureTarget.startsWith(secureWorkspace)) {
            return null;
        }
        return secureWorkspace.relativize(secureTarget).toString().replace('\\', '/');
    }

    public static boolean isGitInternal(Path target) {
        Path absolute = target.toAbsolutePath().normalize();
        for (Path segment : absolute) {
            if (".git".equalsIgnoreCase(segment.toString())) {
                return true;
            }
        }
        return false;
    }

    private static void validateSystemPath(String rawPath) {
        if (rawPath.indexOf('\0') >= 0) {
            throw new ServiceException("路径包含非法字符");
        }
        if (!WINDOWS) {
            return;
        }
        String normalized = rawPath.replace('/', '\\');
        String upper = normalized.toUpperCase(Locale.ROOT);
        if (upper.startsWith("\\\\.\\") || upper.startsWith("\\\\?\\") || upper.contains("\\GLOBALROOT\\")) {
            throw new ServiceException("不支持 Windows 设备路径");
        }
        String withoutDrive = normalized.length() >= 2 && normalized.charAt(1) == ':' ? normalized.substring(2) : normalized;
        if (withoutDrive.indexOf(':') >= 0) {
            throw new ServiceException("不支持 Windows ADS 路径");
        }
        for (String segment : normalized.split("\\\\")) {
            if (segment.isBlank() || segment.endsWith(":")) {
                continue;
            }
            String name = segment.stripTrailing().replaceAll("\\.+$", "");
            int dot = name.indexOf('.');
            if (dot >= 0) {
                name = name.substring(0, dot);
            }
            if (WINDOWS_RESERVED_NAMES.contains(name.toUpperCase(Locale.ROOT))) {
                throw new ServiceException("不支持 Windows 保留设备名");
            }
        }
    }
}
