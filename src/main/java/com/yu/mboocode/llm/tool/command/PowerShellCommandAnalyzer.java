package com.yu.mboocode.llm.tool.command;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;

@Component
public class PowerShellCommandAnalyzer {
    private static final String ANALYSIS_ENV = "MBOO_COMMAND_ANALYSIS";
    private static final String ANALYSIS_SCRIPT = """
            $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:MBOO_COMMAND_ANALYSIS))
            $tokens = $null
            $errors = $null
            $ast = [Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
            $commands = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true))
            $blocks = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.ScriptBlockAst] }, $true))
            Write-Output ('{0}|{1}|{2}' -f $errors.Count, $commands.Count, $blocks.Count)
            """;

    public CommandAnalysis analyze(ResolvedCommand command) {
        if (!astAllowsSingleCommand(command)) return CommandAnalysis.unsafe();
        String commandText = command.command();
        List<String> tokens = new ArrayList<>();
        StringBuilder token = new StringBuilder();
        boolean singleQuoted = false;
        boolean doubleQuoted = false;
        boolean tokenStarted = false;
        for (int i = 0; i < commandText.length(); i++) {
            char current = commandText.charAt(i);
            if (current == '`') return CommandAnalysis.unsafe();
            if (current == '\'' && !doubleQuoted) {
                if (singleQuoted && i + 1 < commandText.length() && commandText.charAt(i + 1) == '\'') {
                    token.append('\'');
                    i++;
                    tokenStarted = true;
                } else {
                    singleQuoted = !singleQuoted;
                    tokenStarted = true;
                }
                continue;
            }
            if (current == '"' && !singleQuoted) {
                doubleQuoted = !doubleQuoted;
                tokenStarted = true;
                continue;
            }
            if (!singleQuoted && (current == '$' || current == '@')) return CommandAnalysis.unsafe();
            if (!singleQuoted && !doubleQuoted && isCompound(current)) return CommandAnalysis.unsafe();
            if (!singleQuoted && !doubleQuoted && Character.isWhitespace(current)) {
                if (current == '\r' || current == '\n') return CommandAnalysis.unsafe();
                if (tokenStarted) {
                    tokens.add(token.toString());
                    token.setLength(0);
                    tokenStarted = false;
                }
                continue;
            }
            token.append(current);
            tokenStarted = true;
        }
        if (singleQuoted || doubleQuoted) return CommandAnalysis.unsafe();
        if (tokenStarted) tokens.add(token.toString());
        return tokens.isEmpty() ? CommandAnalysis.unsafe() : new CommandAnalysis(true, false, tokens);
    }

    private boolean astAllowsSingleCommand(ResolvedCommand command) {
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(command.shell().executable().toString(), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ANALYSIS_SCRIPT);
            builder.redirectErrorStream(true);
            builder.environment().put(ANALYSIS_ENV, Base64.getEncoder().encodeToString(command.command().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            process = builder.start();
            process.getOutputStream().close();
            if (!process.waitFor(2, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                return false;
            }
            String result = new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).trim();
            return process.exitValue() == 0 && "0|1|1".equals(result);
        } catch (Exception e) {
            return false;
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
        }
    }

    private boolean isCompound(char value) {
        return value == '|' || value == '&' || value == ';' || value == '<' || value == '>' || value == '(' || value == ')' || value == '{' || value == '}';
    }
}
