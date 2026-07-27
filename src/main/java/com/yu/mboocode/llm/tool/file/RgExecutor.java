package com.yu.mboocode.llm.tool.file;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
public class RgExecutor {
    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final Version MIN_VERSION = new Version(13, 0, 0);
    private static final Pattern VERSION_PATTERN = Pattern.compile("ripgrep\\s+(\\d+)\\.(\\d+)\\.(\\d+)");
    private volatile boolean versionChecked;

    public RgResult execute(List<String> arguments, FileToolErrorCode invalidExpressionCode) {
        ensureVersion();
        List<String> command = new ArrayList<>(arguments.size() + 1);
        command.add("rg");
        command.addAll(arguments);
        Process process;
        try {
            process = new ProcessBuilder(command).redirectErrorStream(false).start();
        } catch (IOException e) {
            throw new FileToolException(FileToolErrorCode.RG_NOT_FOUND, "系统未找到 ripgrep（rg）", e);
        }

        CompletableFuture<byte[]> stdout = CompletableFuture.supplyAsync(() -> readAll(process.getInputStream()));
        CompletableFuture<byte[]> stderr = CompletableFuture.supplyAsync(() -> readAll(process.getErrorStream()));
        try {
            if (!process.waitFor(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)) {
                process.destroyForcibly();
                throw new FileToolException(FileToolErrorCode.RG_TIMEOUT, "ripgrep 执行超时");
            }
            String output = new String(stdout.get(5, TimeUnit.SECONDS), StandardCharsets.UTF_8);
            String error = new String(stderr.get(5, TimeUnit.SECONDS), StandardCharsets.UTF_8);
            int exitCode = process.exitValue();
            if (exitCode == 0 || exitCode == 1) {
                return new RgResult(exitCode, output, error);
            }
            String message = truncateError(error);
            if (invalidExpressionCode != null && isExpressionError(message)) {
                throw new FileToolException(invalidExpressionCode, message);
            }
            throw new FileToolException(FileToolErrorCode.RG_EXECUTION_FAILED, StrValue.defaultIfBlank(message, "ripgrep 执行失败"));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new FileToolException(FileToolErrorCode.RG_EXECUTION_FAILED, "ripgrep 执行被中断", e);
        } catch (TimeoutException e) {
            process.destroyForcibly();
            throw new FileToolException(FileToolErrorCode.RG_TIMEOUT, "读取 ripgrep 结果超时", e);
        } catch (FileToolException e) {
            throw e;
        } catch (Exception e) {
            throw new FileToolException(FileToolErrorCode.RG_EXECUTION_FAILED, "读取 ripgrep 结果失败", e);
        }
    }

    private synchronized void ensureVersion() {
        if (versionChecked) {
            return;
        }
        Process process;
        try {
            process = new ProcessBuilder("rg", "--version").redirectErrorStream(true).start();
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new FileToolException(FileToolErrorCode.RG_TIMEOUT, "检查 ripgrep 版本超时");
            }
            String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            Matcher matcher = VERSION_PATTERN.matcher(output);
            if (!matcher.find()) {
                throw new FileToolException(FileToolErrorCode.DEPENDENCY_VERSION_UNSUPPORTED, "无法识别 ripgrep 版本，最低要求 13.0.0");
            }
            Version actual = new Version(Integer.parseInt(matcher.group(1)), Integer.parseInt(matcher.group(2)), Integer.parseInt(matcher.group(3)));
            if (actual.compareTo(MIN_VERSION) < 0) {
                throw new FileToolException(FileToolErrorCode.DEPENDENCY_VERSION_UNSUPPORTED, "ripgrep 版本不满足要求，最低版本 13.0.0，当前版本 " + actual);
            }
            versionChecked = true;
        } catch (FileToolException e) {
            throw e;
        } catch (IOException e) {
            throw new FileToolException(FileToolErrorCode.RG_NOT_FOUND, "系统未找到 ripgrep（rg）", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FileToolException(FileToolErrorCode.RG_EXECUTION_FAILED, "检查 ripgrep 版本被中断", e);
        }
    }

    private byte[] readAll(java.io.InputStream input) {
        try (input) {
            return input.readAllBytes();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private boolean isExpressionError(String message) {
        String lower = message.toLowerCase(Locale.ROOT);
        return lower.contains("regex parse error") || lower.contains("error parsing glob") || lower.contains("invalid glob") || lower.contains("unclosed");
    }

    private String truncateError(String error) {
        String value = error == null ? "" : error.strip();
        return value.length() <= 1000 ? value : value.substring(0, 1000) + "...（错误信息已截断）";
    }

    public record RgResult(int exitCode, String stdout, String stderr) {
    }

    private record Version(int major, int minor, int patch) implements Comparable<Version> {
        @Override
        public int compareTo(Version other) {
            int result = Integer.compare(major, other.major);
            if (result != 0) return result;
            result = Integer.compare(minor, other.minor);
            return result != 0 ? result : Integer.compare(patch, other.patch);
        }

        @Override
        public String toString() {
            return major + "." + minor + "." + patch;
        }
    }

    private static class StrValue {
        private static String defaultIfBlank(String value, String defaultValue) {
            return value == null || value.isBlank() ? defaultValue : value;
        }
    }
}
