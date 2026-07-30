package com.yu.mboocode.llm.tool.command;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class RunningCommandRegistry {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    private final Map<String, RunningCommand> commands = new ConcurrentHashMap<>();
    private final ProcessTreeTerminator terminator;

    public RunningCommandRegistry(WindowsProcessTreeTerminator windowsTerminator, UnixProcessTreeTerminator unixTerminator) {
        this.terminator = WINDOWS ? windowsTerminator : unixTerminator;
    }

    public RunningCommand register(String sessionId, String turnId, String toolCallId) {
        RunningCommand command = new RunningCommand(sessionId, turnId, toolCallId, Thread.currentThread());
        RunningCommand existing = commands.putIfAbsent(key(sessionId, toolCallId), command);
        if (existing != null) throw new IllegalStateException("命令调用已登记: " + toolCallId);
        return command;
    }

    public void remove(RunningCommand command) {
        commands.remove(key(command.sessionId(), command.toolCallId()), command);
    }

    public boolean terminate(RunningCommand command, RunningCommand.CancelReason reason) {
        command.markCancelled(reason);
        Process process = command.process();
        if (process == null) {
            command.executionThread().interrupt();
            return true;
        }
        if (!command.terminating().compareAndSet(false, true)) {
            try {
                return command.terminationResult().get(CommandExecutor.TERMINATION_GRACE_MS * 3, TimeUnit.MILLISECONDS);
            } catch (Exception e) {
                return command.terminationComplete();
            }
        }
        try {
            boolean complete = terminator.terminate(process, CommandExecutor.TERMINATION_GRACE_MS);
            command.terminationComplete(complete);
            command.terminationResult().complete(complete);
            return complete;
        } catch (RuntimeException e) {
            command.terminationComplete(false);
            command.terminationResult().complete(false);
            return false;
        }
    }

    public void cancelTurn(String sessionId, String turnId) {
        commands.values().stream()
                .filter(command -> command.sessionId().equals(sessionId) && java.util.Objects.equals(command.turnId(), turnId))
                .forEach(command -> terminate(command, RunningCommand.CancelReason.CANCELLED));
    }

    public void clearSession(String sessionId) {
        commands.values().stream()
                .filter(command -> command.sessionId().equals(sessionId))
                .forEach(command -> terminate(command, RunningCommand.CancelReason.CANCELLED));
    }

    @PreDestroy
    public void shutdown() {
        commands.values().forEach(command -> terminate(command, RunningCommand.CancelReason.SHUTDOWN));
    }

    private String key(String sessionId, String toolCallId) {
        return sessionId + ":" + toolCallId;
    }
}
