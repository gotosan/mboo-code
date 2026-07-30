package com.yu.mboocode.llm.tool.permission;

import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.command.CommandAnalysis;
import com.yu.mboocode.llm.tool.command.CommandFingerprintUtil;
import com.yu.mboocode.llm.tool.command.CommandPermissionMatcher;
import com.yu.mboocode.llm.tool.command.CommandPermissionRule.CommandAction;
import com.yu.mboocode.llm.tool.command.CommandRequest;
import com.yu.mboocode.llm.tool.command.CommandRuleMatch;
import com.yu.mboocode.llm.tool.command.CommandSafetyAnalyzer;
import com.yu.mboocode.llm.tool.command.CommandToolException;
import com.yu.mboocode.llm.tool.command.ReadOnlyCommandClassifier;
import com.yu.mboocode.llm.tool.command.ResolvedCommand;
import com.yu.mboocode.llm.tool.command.ShellResolver;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Component
public class CommandToolPermissionEvaluator implements ToolPermissionEvaluator {
    private final SessionService sessionService;
    private final ShellResolver shellResolver;
    private final CommandPermissionMatcher commandPermissionMatcher;
    private final CommandSafetyAnalyzer commandSafetyAnalyzer;
    private final ReadOnlyCommandClassifier readOnlyCommandClassifier;

    public CommandToolPermissionEvaluator(SessionService sessionService, ShellResolver shellResolver, CommandPermissionMatcher commandPermissionMatcher,
                                          CommandSafetyAnalyzer commandSafetyAnalyzer, ReadOnlyCommandClassifier readOnlyCommandClassifier) {
        this.sessionService = sessionService;
        this.shellResolver = shellResolver;
        this.commandPermissionMatcher = commandPermissionMatcher;
        this.commandSafetyAnalyzer = commandSafetyAnalyzer;
        this.readOnlyCommandClassifier = readOnlyCommandClassifier;
    }

    @Override
    public boolean supports(ToolPermissionSpec spec) {
        return spec.permissionType() == ToolPermissionType.COMMAND;
    }

    @Override
    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        CommandRequest commandRequest = CommandRequest.parse(request.arguments());
        ResolvedCommand command = resolve(sessionId, commandRequest);
        Sessions session = sessionService.getSession(sessionId);
        SessionPermissions permissions = sessionService.getSessionPermissions(session);
        CommandAnalysis analysis = commandSafetyAnalyzer.analyze(command);
        Optional<CommandRuleMatch> rule = commandPermissionMatcher.match(command.command());
        PermissionCheck commandCheck = evaluateCommand(command, analysis, rule, permissions);
        if (commandCheck.status() == PermissionCheck.CheckStatus.ERROR) {
            return new ToolPermissionChain(List.of(commandRequirement(command, commandCheck)));
        }

        List<PermissionRequirement> requirements = new ArrayList<>();
        Path workspace = FilePermissionUtil.toSecurePath(Path.of(session.getWorkspacePath()));
        if (!FilePermissionUtil.isUnder(command.workdir(), workspace)) {
            String grantPath = FilePermissionUtil.toStoredPath(command.workdir());
            PermissionCheck writeCheck = FilePermissionUtil.isCoveredByAny(command.workdir(), permissions.getReadWritePaths()) ? PermissionCheck.allowed(grantPath) : PermissionCheck.needAsk(grantPath);
            requirements.add(new PermissionRequirement(ToolPermissionType.WRITE, grantPath, grantPath, "允许从工作区外目录执行命令",
                    "命令将在工作区外目录启动。允许读写此目录及其子目录。此授权也适用于当前会话的文件工具，且不限制命令通过其他路径访问文件。", writeCheck));
        }
        requirements.add(commandRequirement(command, commandCheck));
        return new ToolPermissionChain(requirements);
    }

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

    private PermissionCheck evaluateCommand(ResolvedCommand command, CommandAnalysis analysis, Optional<CommandRuleMatch> rule, SessionPermissions permissions) {
        String fingerprint = CommandFingerprintUtil.create(command);
        if (rule.isPresent()) {
            CommandRuleMatch match = rule.get();
            if (match.action() == CommandAction.DENY) return PermissionCheck.error(ToolPermissionErrorCode.COMMAND_PERMISSION_DENIED, "内置命令规则禁止执行此命令");
            if (match.action() == CommandAction.ASK) return permissions.getAllowedCommands().contains(fingerprint) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
            if (analysis.compound() && match.wildcard()) return permissions.getAllowedCommands().contains(fingerprint) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
            return PermissionCheck.allowed();
        }
        if (permissions.getAllowedCommands().contains(fingerprint)) return PermissionCheck.allowed();
        if (readOnlyCommandClassifier.isReadOnly(command, analysis)) return PermissionCheck.allowed();
        return PermissionCheck.needAsk();
    }

    private PermissionRequirement commandRequirement(ResolvedCommand command, PermissionCheck check) {
        String fingerprint = CommandFingerprintUtil.create(command);
        String description = "工作目录：" + command.workdir() + "\nShell：" + command.shell().value();
        if (command.description() != null && !command.description().isBlank()) description += "\n模型提供的用途说明：" + command.description();
        description += "\n命令可访问工作目录之外的文件和网络，请确认命令内容中未内联密码、Token 或其他密钥。";
        return new PermissionRequirement(ToolPermissionType.COMMAND, null, fingerprint, "允许执行命令", description, check);
    }
}
