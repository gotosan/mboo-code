package com.yu.mboocode.agent.tool.command;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Comparator;
import java.util.List;

@Component
public class UnixProcessTreeTerminator implements ProcessTreeTerminator {
    @Override
    public boolean terminate(Process process, long graceMs) {
        if (process == null) return true;
        List<ProcessHandle> descendants = process.descendants().sorted(Comparator.comparingInt(this::depth).reversed()).toList();
        descendants.forEach(ProcessHandle::destroy);
        process.destroy();
        waitFor(descendants, process.toHandle(), graceMs);
        descendants.stream().filter(ProcessHandle::isAlive).forEach(ProcessHandle::destroyForcibly);
        if (process.isAlive()) process.destroyForcibly();
        waitFor(descendants, process.toHandle(), Math.min(1_000, graceMs));
        return !process.isAlive() && descendants.stream().noneMatch(ProcessHandle::isAlive);
    }

    private int depth(ProcessHandle process) {
        int depth = 0;
        ProcessHandle current = process;
        while (current.parent().isPresent() && depth < 1_024) {
            current = current.parent().get();
            depth++;
        }
        return depth;
    }

    private void waitFor(List<ProcessHandle> descendants, ProcessHandle root, long timeoutMs) {
        long deadline = System.nanoTime() + Duration.ofMillis(timeoutMs).toNanos();
        while (System.nanoTime() < deadline && (root.isAlive() || descendants.stream().anyMatch(ProcessHandle::isAlive))) {
            try {
                Thread.sleep(25);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }
}
