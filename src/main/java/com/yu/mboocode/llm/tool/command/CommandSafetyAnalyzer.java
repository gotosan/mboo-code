package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.tool.command.ResolvedCommand.ShellType;
import org.springframework.stereotype.Component;

@Component
public class CommandSafetyAnalyzer {
    private final PosixCommandAnalyzer posixCommandAnalyzer;
    private final PowerShellCommandAnalyzer powerShellCommandAnalyzer;

    public CommandSafetyAnalyzer(PosixCommandAnalyzer posixCommandAnalyzer, PowerShellCommandAnalyzer powerShellCommandAnalyzer) {
        this.posixCommandAnalyzer = posixCommandAnalyzer;
        this.powerShellCommandAnalyzer = powerShellCommandAnalyzer;
    }

    public CommandAnalysis analyze(ResolvedCommand command) {
        try {
            return command.shell().type() == ShellType.POWERSHELL ? powerShellCommandAnalyzer.analyze(command) : posixCommandAnalyzer.analyze(command.command());
        } catch (RuntimeException e) {
            return CommandAnalysis.unsafe();
        }
    }
}
