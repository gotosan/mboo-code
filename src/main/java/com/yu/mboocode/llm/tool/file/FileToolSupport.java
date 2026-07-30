package com.yu.mboocode.llm.tool.file;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.permission.FilePermissionUtil;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;

@Component
public class FileToolSupport {
    public static final long MAX_FILE_BYTES = 10L * 1024 * 1024;

    @Resource
    private SessionService sessionService;
    @Resource
    private IgnoredFileMatcher ignoredFileMatcher;

    public WorkspacePaths resolve(String sessionId, String rawPath) {
        try {
            Sessions session = sessionService.getSession(sessionId);
            Path workspace = FilePermissionUtil.toSecurePath(Path.of(session.getWorkspacePath()));
            Path requestedTarget = FilePermissionUtil.resolveAbsolutePath(session.getWorkspacePath(), rawPath);
            Path target = FilePermissionUtil.toSecurePath(requestedTarget);
            if (ignoredFileMatcher.isIgnored(requestedTarget) || ignoredFileMatcher.isIgnored(target)) {
                throw new FileToolException(FileToolErrorCode.PATH_IGNORED, "目标路径命中全局忽略规则");
            }
            return new WorkspacePaths(workspace, requestedTarget, target, FilePermissionUtil.workspaceRelativePath(target, workspace));
        } catch (FileToolException e) {
            throw e;
        } catch (ServiceException e) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_PATH, e.getMessage());
        }
    }

    public void validatePathArgument(String path) {
        if (StrUtil.isBlank(path)) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "path 不能为空");
        }
        if (path.length() > FilePermissionUtil.MAX_PATH_LENGTH) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "path 长度不能超过 " + FilePermissionUtil.MAX_PATH_LENGTH + " 个字符");
        }
    }

    public void requireNotIgnored(Path path) {
        if (ignoredFileMatcher.isIgnored(path)) {
            throw new FileToolException(FileToolErrorCode.PATH_IGNORED, "目标路径命中全局忽略规则");
        }
    }

    public void requireWritablePath(Path path) {
        requireNotIgnored(path);
        if (FilePermissionUtil.isGitInternal(path)) {
            throw new FileToolException(FileToolErrorCode.GIT_INTERNAL_WRITE_DENIED, "禁止修改 .git 内部文件");
        }
    }

    public void requireWritablePath(WorkspacePaths paths) {
        requireWritablePath(paths.target());
        if (FilePermissionUtil.isGitInternal(paths.requestedTarget())) {
            throw new FileToolException(FileToolErrorCode.GIT_INTERNAL_WRITE_DENIED, "禁止修改 .git 内部文件");
        }
    }

    public void requireDirectory(Path path) {
        if (Files.notExists(path)) {
            throw new FileToolException(ToolCommonErrorCode.PATH_NOT_FOUND, "目标路径不存在");
        }
        if (!Files.isDirectory(path)) {
            throw new FileToolException(ToolCommonErrorCode.PATH_NOT_DIRECTORY, "目标路径不是目录");
        }
    }

    public void requireRegularFile(Path path) {
        if (Files.notExists(path)) {
            throw new FileToolException(ToolCommonErrorCode.PATH_NOT_FOUND, "目标文件不存在");
        }
        if (!Files.isRegularFile(path)) {
            throw new FileToolException(FileToolErrorCode.PATH_NOT_REGULAR_FILE, "目标路径不是普通文件");
        }
    }

    public IgnoredFileMatcher ignoredFileMatcher() {
        return ignoredFileMatcher;
    }

    public record WorkspacePaths(Path workspace, Path requestedTarget, Path target, String workspaceRelativePath) {
    }
}
