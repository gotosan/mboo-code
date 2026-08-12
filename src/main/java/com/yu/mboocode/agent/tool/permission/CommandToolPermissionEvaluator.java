package com.yu.mboocode.agent.tool.permission;

import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.agent.tool.command.CommandFingerprintUtil;
import com.yu.mboocode.agent.tool.command.CommandPermissionMatcher;
import com.yu.mboocode.agent.tool.command.CommandPermissionMatcher.CommandAction;
import com.yu.mboocode.agent.tool.command.CommandPermissionMatcher.CommandRuleMatch;
import com.yu.mboocode.agent.tool.command.CommandRequest;
import com.yu.mboocode.agent.tool.command.CommandResolver;
import com.yu.mboocode.agent.tool.command.ReadOnlyCommandClassifier;
import com.yu.mboocode.agent.tool.command.ReadOnlyCommandClassifier.CommandAnalysis;
import com.yu.mboocode.agent.tool.command.ResolvedCommand;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Component
public class CommandToolPermissionEvaluator implements ToolPermissionEvaluator {
    @Resource
    private SessionService sessionService;
    @Resource
    private CommandResolver commandResolver;
    @Resource
    private CommandPermissionMatcher commandPermissionMatcher;
    @Resource
    private ReadOnlyCommandClassifier readOnlyCommandClassifier;

    @Override
    public boolean supports(ToolPermissionSpec spec) {
        return spec.permissionType() == ToolPermissionType.COMMAND;
    }

    @Override
    public ToolPermissionChain evaluate(String sessionId, ToolExecutionRequest request, ToolPermissionSpec spec) {
        CommandRequest commandRequest = CommandRequest.parse(request.arguments());
        ResolvedCommand command = commandResolver.resolve(sessionId, commandRequest);
        Sessions session = sessionService.getSession(sessionId);
        SessionPermissions permissions = sessionService.getSessionPermissions(session);
        CommandAnalysis analysis = readOnlyCommandClassifier.analyze(command);
        Optional<CommandRuleMatch> rule = commandPermissionMatcher.match(command.command());
        PermissionCheck commandCheck = evaluateCommand(command, analysis, rule, permissions);
        if (commandCheck.status() == PermissionCheck.CheckStatus.ERROR) {
            return new ToolPermissionChain(List.of(commandRequirement(command, commandCheck)));
        }

        List<PermissionRequirement> requirements = new ArrayList<>();
        Path workspace = FilePermissionUtil.toSecurePath(Path.of(session.getWorkspacePath()));
        if (!FilePermissionUtil.isUnder(command.workdir(), workspace)) {
            String grantPath = FilePermissionUtil.toStoredPath(command.workdir());
            PermissionCheck writeCheck = FilePermissionUtil.isCoveredByAny(command.workdir(), permissions.getReadWritePaths()) ? PermissionCheck.allowed() : PermissionCheck.needAsk();
            requirements.add(new PermissionRequirement(ToolPermissionType.WRITE, grantPath, grantPath, "允许从工作区外目录执行命令",
                    "命令将在工作区外目录启动。允许读写此目录及其子目录。此授权也适用于当前会话的文件工具，且不限制命令通过其他路径访问文件。", writeCheck));
        }
        requirements.add(commandRequirement(command, commandCheck));
        return new ToolPermissionChain(requirements);
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
