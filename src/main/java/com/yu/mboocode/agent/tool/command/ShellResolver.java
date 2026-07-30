package com.yu.mboocode.agent.tool.command;

import com.yu.mboocode.agent.tool.command.ResolvedCommand.ShellIdentity;
import com.yu.mboocode.agent.tool.command.ResolvedCommand.ShellType;
import org.springframework.stereotype.Component;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

@Component
public class ShellResolver {
    private static final List<String> WINDOWS_SHELL_CANDIDATES = List.of("pwsh.exe", "pwsh", "powershell.exe");
    private static final List<String> WINDOWS_ARGUMENTS = List.of("-NoLogo", "-NoProfile", "-NonInteractive", "-Command");
    private static final Path UNIX_FALLBACK_SHELL = Path.of("/bin/sh");
    private static final List<String> UNIX_ARGUMENTS = List.of("-c");
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    private volatile ShellIdentity cachedShell;

    public ShellIdentity resolve() {
        ShellIdentity current = cachedShell;
        if (current != null) return current;
        synchronized (this) {
            if (cachedShell == null) cachedShell = resolveUncached();
            return cachedShell;
        }
    }

    private ShellIdentity resolveUncached() {
        if (WINDOWS) {
            for (String candidate : WINDOWS_SHELL_CANDIDATES) {
                Path executable = findExecutable(candidate);
                if (executable == null) continue;
                ShellIdentity identity = new ShellIdentity(shellPath(executable), WINDOWS_ARGUMENTS, ShellType.POWERSHELL);
                if (probe(identity)) return identity;
            }
        } else {
            Path environmentShell = knownUnixShell(System.getenv("SHELL"));
            if (environmentShell != null) {
                ShellIdentity identity = new ShellIdentity(shellPath(environmentShell), UNIX_ARGUMENTS, ShellType.POSIX);
                if (probe(identity)) return identity;
            }
            if (isExecutable(UNIX_FALLBACK_SHELL)) {
                ShellIdentity identity = new ShellIdentity(shellPath(UNIX_FALLBACK_SHELL), UNIX_ARGUMENTS, ShellType.POSIX);
                if (probe(identity)) return identity;
            }
        }
        throw new CommandToolException(CommandToolErrorCode.COMMAND_SHELL_NOT_FOUND, "找不到可用的非交互 Shell");
    }

    public List<String> processArguments(ResolvedCommand command) {
        List<String> arguments = new ArrayList<>();
        arguments.add(command.shell().executable().toString());
        arguments.addAll(command.shell().fixedArguments());
        if (command.shell().type() == ShellType.POWERSHELL) {
            String encodingPrefix = "[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $OutputEncoding = [Text.UTF8Encoding]::new($false); ";
            arguments.add(encodingPrefix + command.command());
        } else {
            arguments.add(command.command());
        }
        return arguments;
    }

    private Path knownUnixShell(String rawShell) {
        if (rawShell == null || rawShell.isBlank()) return null;
        try {
            Path path = Path.of(rawShell);
            String name = path.getFileName() == null ? "" : path.getFileName().toString().toLowerCase(Locale.ROOT);
            if (!List.of("sh", "bash", "zsh", "dash", "ksh").contains(name) || !isExecutable(path)) return null;
            return path;
        } catch (InvalidPathException e) {
            return null;
        }
    }

    private Path findExecutable(String name) {
        String pathValue = System.getenv("PATH");
        if (pathValue == null) return null;
        for (String directory : pathValue.split(File.pathSeparator)) {
            if (directory.isBlank()) continue;
            try {
                Path candidate = Path.of(directory, name);
                if (isExecutable(candidate)) return candidate;
            } catch (InvalidPathException ignored) {
                // PATH 中的无效条目不阻止继续发现后续候选项。
            }
        }
        return null;
    }

    private boolean isExecutable(Path path) {
        return Files.isRegularFile(path) && (WINDOWS || Files.isExecutable(path));
    }

    private Path shellPath(Path path) {
        try {
            return path.toRealPath();
        } catch (Exception e) {
            if (WINDOWS && Files.isRegularFile(path)) return path.toAbsolutePath().normalize();
            throw new CommandToolException(CommandToolErrorCode.COMMAND_SHELL_NOT_FOUND, "无法解析 Shell 真实路径");
        }
    }

    private boolean probe(ShellIdentity identity) {
        Process process = null;
        try {
            List<String> arguments = new ArrayList<>();
            arguments.add(identity.executable().toString());
            arguments.addAll(identity.fixedArguments());
            arguments.add("exit 0");
            process = new ProcessBuilder(arguments)
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .start();
            process.getOutputStream().close();
            return process.waitFor(2, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception e) {
            return false;
        } finally {
            if (process != null && process.isAlive()) process.destroyForcibly();
        }
    }
}
