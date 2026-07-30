package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.dto.CommandExecutionData;
import com.yu.mboocode.llm.tool.BoundedTextCollector;
import com.yu.mboocode.llm.tool.ToolTextTruncator;
import org.springframework.stereotype.Component;

import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

@Component
public class CommandExecutor {
    public static final int MAX_CONCURRENT_COMMANDS = 4;
    public static final long TERMINATION_GRACE_MS = 2_000;
    private final Semaphore concurrentCommands = new Semaphore(MAX_CONCURRENT_COMMANDS, true);
    private final Map<String, ReentrantLock> sessionLocks = new java.util.concurrent.ConcurrentHashMap<>();
    private final ShellResolver shellResolver;
    private final RunningCommandRegistry runningCommandRegistry;
    private final ToolTextTruncator truncator;

    public CommandExecutor(ShellResolver shellResolver, RunningCommandRegistry runningCommandRegistry, ToolTextTruncator truncator) {
        this.shellResolver = shellResolver;
        this.runningCommandRegistry = runningCommandRegistry;
        this.truncator = truncator;
    }

    public CommandExecutionData execute(String sessionId, String turnId, String toolCallId, ResolvedCommand command) {
        RunningCommand running = runningCommandRegistry.register(sessionId, turnId, toolCallId);
        ReentrantLock sessionLock = sessionLocks.computeIfAbsent(sessionId, ignored -> new ReentrantLock(true));
        boolean sessionAcquired = false;
        boolean globalAcquired = false;
        long processStartNanos = 0;
        try {
            sessionLock.lockInterruptibly();
            sessionAcquired = true;
            concurrentCommands.acquire();
            globalAcquired = true;
            Process process;
            try {
                ProcessBuilder builder = new ProcessBuilder(shellResolver.processArguments(command));
                builder.directory(command.workdir().toFile()).redirectErrorStream(true);
                builder.environment().put("GIT_PAGER", "cat");
                builder.environment().put("PAGER", "cat");
                builder.environment().put("GIT_OPTIONAL_LOCKS", "0");
                builder.environment().put("GIT_CONFIG_COUNT", "2");
                builder.environment().put("GIT_CONFIG_KEY_0", "core.pager");
                builder.environment().put("GIT_CONFIG_VALUE_0", "cat");
                builder.environment().put("GIT_CONFIG_KEY_1", "core.fsmonitor");
                builder.environment().put("GIT_CONFIG_VALUE_1", "false");
                process = builder.start();
                running.process(process);
                running.startedAt(java.time.Instant.now());
                processStartNanos = System.nanoTime();
                process.getOutputStream().close();
            } catch (Exception e) {
                throw new CommandToolException(CommandToolErrorCode.COMMAND_START_FAILED, "Shell 进程启动失败", e);
            }

            BoundedTextCollector collector = new BoundedTextCollector(RunCommandTool.MAX_OUTPUT_CHARACTERS, RunCommandTool.MAX_OUTPUT_LINES);
            CompletableFuture<OutputRead> outputFuture = new CompletableFuture<>();
            Thread.startVirtualThread(() -> readOutput(process, collector, outputFuture));
            boolean timedOut = false;
            try {
                if (!process.waitFor(command.timeoutMs(), TimeUnit.MILLISECONDS)) {
                    timedOut = true;
                    runningCommandRegistry.terminate(running, RunningCommand.CancelReason.TIMEOUT);
                    process.waitFor(2_500, TimeUnit.MILLISECONDS);
                }
            } catch (InterruptedException e) {
                runningCommandRegistry.terminate(running, RunningCommand.CancelReason.INTERRUPTED);
                Thread.currentThread().interrupt();
            }

            OutputRead output;
            try {
                output = outputFuture.get(3, TimeUnit.SECONDS);
            } catch (java.util.concurrent.TimeoutException e) {
                try {
                    process.getInputStream().close();
                } catch (Exception ignored) {
                    // 输出管道无法及时关闭时按输出读取失败返回。
                }
                output = new OutputRead(false, true);
            }
            if (running.cancelReason() != null && running.process() != null) {
                runningCommandRegistry.terminate(running, running.cancelReason());
            }
            int exitCode = process.isAlive() ? -1 : process.exitValue();
            long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - processStartNanos);
            BoundedTextCollector.CollectedText collected = collector.finish(truncator);
            CommandExecutionData data = new CommandExecutionData(command.command(), command.workdir().toString(), command.shell().value(),
                    exitCode < 0 ? null : exitCode, collected.text(), durationMs, timedOut || running.cancelReason() == RunningCommand.CancelReason.TIMEOUT,
                    running.cancelReason() == RunningCommand.CancelReason.CANCELLED || running.cancelReason() == RunningCommand.CancelReason.SHUTDOWN,
                    collected.truncated(), collected.omittedCharacters() > 0 ? collected.omittedCharacters() : null,
                    collected.omittedLines() > 0 ? collected.omittedLines() : null, output.encodingWarning(), running.terminationComplete());
            if (running.cancelReason() == RunningCommand.CancelReason.INTERRUPTED) throw new CommandToolException(CommandToolErrorCode.COMMAND_INTERRUPTED, "命令执行线程被中断", data);
            if (data.cancelled()) throw new CommandToolException(CommandToolErrorCode.COMMAND_CANCELLED, "命令已取消", data);
            if (data.timedOut()) throw new CommandToolException(CommandToolErrorCode.COMMAND_TIMEOUT, "命令执行超时", data);
            if (!data.terminationComplete()) throw new CommandToolException(CommandToolErrorCode.COMMAND_TERMINATION_FAILED, "无法确认全部命令进程已终止", data);
            if (output.failed()) throw new CommandToolException(CommandToolErrorCode.COMMAND_OUTPUT_READ_FAILED, "读取命令输出失败", data);
            if (exitCode != 0) throw new CommandToolException(CommandToolErrorCode.COMMAND_EXIT_NON_ZERO, "命令以非零退出码结束", data);
            return data;
        } catch (InterruptedException e) {
            if (running.cancelReason() == null) runningCommandRegistry.terminate(running, RunningCommand.CancelReason.INTERRUPTED);
            Thread.currentThread().interrupt();
            if (running.cancelReason() == RunningCommand.CancelReason.CANCELLED || running.cancelReason() == RunningCommand.CancelReason.SHUTDOWN) {
                throw new CommandToolException(CommandToolErrorCode.COMMAND_CANCELLED, "命令已取消");
            }
            throw new CommandToolException(CommandToolErrorCode.COMMAND_INTERRUPTED, "命令排队被中断");
        } catch (CommandToolException e) {
            throw e;
        } catch (Exception e) {
            throw new CommandToolException(CommandToolErrorCode.COMMAND_EXECUTION_ERROR, "命令执行失败", e);
        } finally {
            if (globalAcquired) concurrentCommands.release();
            if (sessionAcquired) sessionLock.unlock();
            runningCommandRegistry.remove(running);
        }
    }

    private void readOutput(Process process, BoundedTextCollector collector, CompletableFuture<OutputRead> result) {
        boolean warning = false;
        try (Reader reader = new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE))) {
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) >= 0) {
                for (int i = 0; i < read; i++) warning |= buffer[i] == '\ufffd';
                collector.append(buffer, 0, read);
            }
            result.complete(new OutputRead(warning, false));
        } catch (Exception e) {
            result.complete(new OutputRead(warning, true));
        }
    }

    private record OutputRead(boolean encodingWarning, boolean failed) {
    }
}
