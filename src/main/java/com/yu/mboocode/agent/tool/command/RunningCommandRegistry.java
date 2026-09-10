package com.yu.mboocode.agent.tool.command;

import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Component
public class RunningCommandRegistry {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    private final Map<String, RunningCommand> commands = new ConcurrentHashMap<>();
    private final java.util.concurrent.ScheduledExecutorService tracker = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "command-process-tracker");
        thread.setDaemon(true);
        return thread;
    });

    @jakarta.annotation.PostConstruct
    public void startTracking() {
        tracker.scheduleWithFixedDelay(() -> commands.values().forEach(command -> {
            try { command.captureProcesses(); } catch (RuntimeException ignored) { /* 保留已捕获身份供清理检查。 */ }
        }), 0, 50, TimeUnit.MILLISECONDS);
    }

    @Resource
    private WindowsProcessTreeTerminator windowsTerminator;
    @Resource
    private UnixProcessTreeTerminator unixTerminator;

    public RunningCommand register(String sessionId, String turnId, String toolCallId) {
        RunningCommand command = new RunningCommand(sessionId, turnId, toolCallId, Thread.currentThread());
        RunningCommand existing = commands.putIfAbsent(key(sessionId, turnId, toolCallId), command);
        if (existing != null) throw new IllegalStateException("命令调用已登记: " + toolCallId);
        return command;
    }

    public void remove(RunningCommand command) {
        command.captureProcesses();
        command.executionFinished(true);
        if (command.trackedProcesses().stream().noneMatch(ProcessHandle::isAlive) && command.terminationComplete()) commands.remove(key(command.sessionId(), command.turnId(), command.toolCallId()), command);
    }

    public boolean terminate(RunningCommand command, RunningCommand.CancelReason reason) {
        command.captureProcesses();
        command.markCancelled(reason);
        Process process = command.process();
        if (process == null) {
            if (!command.executionFinished()) command.executionThread().interrupt();
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
            ProcessTreeTerminator terminator = WINDOWS ? windowsTerminator : unixTerminator;
            boolean complete = !process.isAlive() || terminator.terminate(process, CommandExecutor.TERMINATION_GRACE_MS);
            for (ProcessHandle handle : command.trackedProcesses()) {
                if (handle.isAlive()) handle.destroyForcibly();
            }
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(CommandExecutor.TERMINATION_GRACE_MS);
            while (command.trackedProcesses().stream().anyMatch(ProcessHandle::isAlive) && System.nanoTime() < deadline) {
                try { Thread.sleep(20); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            complete = complete && command.trackedProcesses().stream().noneMatch(ProcessHandle::isAlive);
            command.terminationComplete(complete);
            command.terminationResult().complete(complete);
            return complete;
        } catch (RuntimeException e) {
            command.terminationComplete(false);
            command.terminationResult().complete(false);
            return false;
        } finally {
            command.terminating().set(false);
        }
    }

    public void cancelTurn(String sessionId, String turnId) {
        commands.values().stream()
                .filter(command -> command.sessionId().equals(sessionId) && java.util.Objects.equals(command.turnId(), turnId))
                .forEach(command -> terminate(command, RunningCommand.CancelReason.CANCELLED));
    }

    public boolean cleanupComplete(String sessionId, String turnId) {
        var selected = commands.values().stream().filter(command -> command.sessionId().equals(sessionId) && java.util.Objects.equals(command.turnId(), turnId)).toList();
        boolean complete = selected.stream().allMatch(command -> command.executionFinished() && command.terminationComplete() && command.trackedProcesses().stream().noneMatch(ProcessHandle::isAlive));
        if (complete) selected.forEach(command -> commands.remove(key(sessionId, turnId, command.toolCallId()), command));
        return complete;
    }

    public void clearSession(String sessionId) {
        commands.values().stream()
                .filter(command -> command.sessionId().equals(sessionId))
                .forEach(command -> terminate(command, RunningCommand.CancelReason.CANCELLED));
    }

    @PreDestroy
    public void shutdown() {
        tracker.shutdownNow();
        commands.values().forEach(command -> terminate(command, RunningCommand.CancelReason.SHUTDOWN));
    }

    private String key(String sessionId, String turnId, String toolCallId) {
        return sessionId + ":" + turnId + ":" + toolCallId;
    }
}
