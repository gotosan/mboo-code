package com.yu.mboocode.llm.tool.command;

import java.nio.file.Path;
import java.util.List;

public record ResolvedCommand(String command, Path workdir, ShellIdentity shell, long timeoutMs, String description) {
    public record ShellIdentity(Path executable, List<String> fixedArguments, ShellType type) {
        public ShellIdentity {
            fixedArguments = List.copyOf(fixedArguments);
        }

        public String value() {
            return executable + " " + String.join(" ", fixedArguments) + " | utf8-no-profile-v1";
        }
    }

    public enum ShellType {
        POWERSHELL,
        POSIX
    }
}
