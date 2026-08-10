package com.yu.mboocode.agent.util;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.common.exception.ServiceException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Locale;
import java.util.Objects;

public final class WorkspacePathUtil {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    private WorkspacePathUtil() {
    }

    public static String normalizeExistingDirectory(String workspacePath) {
        if (StrUtil.isBlank(workspacePath)) throw new ServiceException("工作区路径不能为空");
        try {
            Path path = Path.of(workspacePath).toAbsolutePath().normalize();
            if (!Files.exists(path)) throw new ServiceException("工作区路径不存在");
            if (!Files.isDirectory(path)) throw new ServiceException("工作区路径不是目录");
            return path.toRealPath().toString();
        } catch (InvalidPathException e) {
            throw new ServiceException("工作区路径格式错误");
        } catch (IOException e) {
            throw new ServiceException("无法解析工作区真实路径");
        }
    }

    public static String pathKey(String normalizedPath) {
        try {
            String path = Path.of(normalizedPath).toAbsolutePath().normalize().toString();
            return (WINDOWS ? "windows:" : "unix:") + (WINDOWS ? path.toLowerCase(Locale.ROOT) : path);
        } catch (InvalidPathException e) {
            throw new ServiceException("工作区路径格式错误");
        }
    }

    public static String displayName(String workspacePath) {
        try {
            Path path = Path.of(workspacePath);
            Path fileName = path.getFileName();
            return fileName == null ? path.toString() : fileName.toString();
        } catch (InvalidPathException e) {
            return workspacePath;
        }
    }

    public static boolean isAvailable(String workspacePath) {
        try {
            return StrUtil.isNotBlank(workspacePath) && Files.isDirectory(Path.of(workspacePath));
        } catch (InvalidPathException e) {
            return false;
        }
    }

    public static boolean isDefaultWorkspacePath(String workspacePath, String sessionId) {
        if (StrUtil.isBlank(workspacePath) || StrUtil.isBlank(sessionId)) return false;
        try {
            Path path = Path.of(workspacePath).toAbsolutePath().normalize();
            Path sessionDirectory = path.getFileName();
            Path dateDirectory = path.getParent() == null ? null : path.getParent().getFileName();
            Path workspacesDirectory = path.getParent() == null || path.getParent().getParent() == null ? null : path.getParent().getParent().getFileName();
            if (!Objects.equals(sessionId, sessionDirectory == null ? null : sessionDirectory.toString())
                    || !Objects.equals("workspaces", workspacesDirectory == null ? null : workspacesDirectory.toString()) || dateDirectory == null) {
                return false;
            }
            LocalDate.parse(dateDirectory.toString());
            return true;
        } catch (InvalidPathException | DateTimeParseException e) {
            return false;
        }
    }
}
