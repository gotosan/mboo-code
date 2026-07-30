package com.yu.mboocode.llm.tool.command;

import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

@Component
public class WindowsProcessTreeTerminator implements ProcessTreeTerminator {
    @Resource
    private UnixProcessTreeTerminator javaFallback;

    @Override
    public boolean terminate(Process process, long graceMs) {
        if (process == null) return true;
        runTaskkill(process.pid(), false, graceMs);
        if (!process.isAlive() && process.descendants().noneMatch(ProcessHandle::isAlive)) return true;
        runTaskkill(process.pid(), true, Math.min(1_000, graceMs));
        if (!process.isAlive() && process.descendants().noneMatch(ProcessHandle::isAlive)) return true;
        return javaFallback.terminate(process, Math.min(1_000, graceMs));
    }

    private void runTaskkill(long pid, boolean force, long timeoutMs) {
        try {
            ProcessBuilder builder = force
                    ? new ProcessBuilder("taskkill.exe", "/PID", Long.toString(pid), "/T", "/F")
                    : new ProcessBuilder("taskkill.exe", "/PID", Long.toString(pid), "/T");
            Process taskkill = builder.redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
            if (!taskkill.waitFor(Math.max(1_000, timeoutMs), TimeUnit.MILLISECONDS)) taskkill.destroyForcibly();
        } catch (Exception ignored) {
            // 固定系统命令失败时继续使用强制调用或 Java ProcessHandle 兜底。
        }
    }
}
