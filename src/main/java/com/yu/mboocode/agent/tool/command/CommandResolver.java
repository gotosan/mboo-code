package com.yu.mboocode.agent.tool.command;

import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.agent.tool.ToolCommonErrorCode;
import com.yu.mboocode.agent.tool.permission.FilePermissionUtil;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 统一解析命令执行和权限评估共同依赖的工作目录、Shell 与有效参数。
 */
@Component
public class CommandResolver {
    @Resource
    private SessionService sessionService;
    @Resource
    private ShellResolver shellResolver;

    public ResolvedCommand resolve(String sessionId, CommandRequest request) {
        Sessions session = sessionService.getSession(sessionId);
        String rawWorkdir = request.workdir() == null || request.workdir().isBlank() ? "." : request.workdir();
        try {
            Path workdir = FilePermissionUtil.toSecurePath(FilePermissionUtil.resolveAbsolutePath(session.getWorkspacePath(), rawWorkdir));
            if (!Files.exists(workdir)) throw new CommandToolException(ToolCommonErrorCode.PATH_NOT_FOUND, "工作目录不存在");
            if (!Files.isDirectory(workdir)) throw new CommandToolException(ToolCommonErrorCode.PATH_NOT_DIRECTORY, "工作目录不是目录");
            return new ResolvedCommand(request.command(), workdir, shellResolver.resolve(), request.effectiveTimeoutMs(), request.description());
        } catch (CommandToolException e) {
            throw e;
        } catch (ServiceException e) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_PATH, e.getMessage());
        }
    }
}
