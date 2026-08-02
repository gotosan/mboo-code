package com.yu.mboocode.agent.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.crypto.digest.DigestUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.dto.ToolResultDetailResp;
import com.yu.mboocode.agent.mapper.SessionsMapper;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.model.ToolResultArtifact;
import com.yu.mboocode.agent.model.payload.ToolCallEndedPayload;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.common.util.DateTimeUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * 将工具结果保存到会话事件日志旁的独立制品文件中。
 */
@Component
@Slf4j
public class ToolResultStore {
    private static final int SCHEMA_VERSION = 1;
    private static final String RESULT_DIRECTORY = "tool-results";
    private static final Pattern RESULT_ID_PATTERN = Pattern.compile("tr_[0-9a-f]{64}");
    private static final Duration TEMP_RETENTION = Duration.ofHours(24);

    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SessionsMapper sessionsMapper;

    public String resultId(String sessionId, String turnId, String toolCallId) {
        if (StrUtil.hasBlank(sessionId, turnId, toolCallId)) throw new ServiceException("工具结果标识参数不完整");
        return "tr_" + DigestUtil.sha256Hex(sessionId + "\0" + turnId + "\0" + toolCallId);
    }

    public ToolResultArtifact saveResult(String transcriptUri, String sessionId, String turnId, String messageId, String toolCallId, String toolName,
                                         ToolCallEndedPayload.ToolCallStatus status, String resultText, String resultPreview) {
        String resultId = resultId(sessionId, turnId, toolCallId);
        Path directory = resultDirectory(transcriptUri);
        Path artifactPath = artifactPath(directory, resultId);
        if (Files.exists(artifactPath)) return readArtifact(artifactPath, sessionId, resultId);

        try {
            Files.createDirectories(directory);
            cleanupTemporaryFiles(directory);
            Path rawOutputPath = rawOutputPath(directory, resultId, true);
            boolean rawOutputComplete = Files.isRegularFile(rawOutputPath);
            if (!rawOutputComplete) rawOutputPath = rawOutputPath(directory, resultId, false);
            boolean rawOutputAvailable = Files.isRegularFile(rawOutputPath);
            long rawOutputSizeBytes = rawOutputAvailable ? Files.size(rawOutputPath) : 0L;
            String safeResultText = resultText == null ? "" : resultText;
            ToolResultArtifact artifact = ToolResultArtifact.builder()
                    .schemaVersion(SCHEMA_VERSION)
                    .resultId(resultId)
                    .sessionId(sessionId)
                    .turnId(turnId)
                    .messageId(messageId)
                    .toolCallId(toolCallId)
                    .toolName(toolName)
                    .status(status.getCode())
                    .contentType(isJson(safeResultText) ? "application/json" : "text/plain")
                    .resultText(safeResultText)
                    .resultPreview(resultPreview == null ? "" : resultPreview)
                    .resultSizeBytes((long) safeResultText.getBytes(StandardCharsets.UTF_8).length)
                    .rawOutputAvailable(rawOutputAvailable)
                    .rawOutputComplete(rawOutputAvailable && rawOutputComplete)
                    .rawOutputSizeBytes(rawOutputAvailable ? rawOutputSizeBytes : null)
                    .createdAt(DateTimeUtil.now())
                    .build();
            writeAtomic(artifactPath, JSON.toJSONString(artifact));
            return artifact;
        } catch (IOException | RuntimeException e) {
            log.error("保存工具结果失败 sessionId:{} turnId:{} toolCallId:{}", sessionId, turnId, toolCallId, e);
            throw new ServiceException("工具已经执行，但结果保存失败，请勿自动重试");
        }
    }

    public ToolResultDetailResp getDetail(String sessionId, String resultId) {
        ToolResultArtifact artifact = getArtifact(sessionId, resultId);
        return new ToolResultDetailResp(artifact.getResultId(), artifact.getToolCallId(), artifact.getToolName(), artifact.getStatus(), artifact.getContentType(),
                artifact.getResultPreview(), artifact.getResultSizeBytes(), artifact.getRawOutputAvailable(), artifact.getRawOutputComplete(),
                artifact.getRawOutputSizeBytes(), artifact.getCreatedAt());
    }

    public String getResultContent(String sessionId, String resultId) {
        return getArtifact(sessionId, resultId).getResultText();
    }

    public Path getRawOutputPath(String sessionId, String resultId) {
        ToolResultArtifact artifact = getArtifact(sessionId, resultId);
        if (!Boolean.TRUE.equals(artifact.getRawOutputAvailable())) throw new ServiceException("当前工具结果没有原始输出");
        Sessions session = getSession(sessionId);
        Path path = rawOutputPath(resultDirectory(session.getTranscriptUri()), resultId, Boolean.TRUE.equals(artifact.getRawOutputComplete()));
        if (!Files.isRegularFile(path)) throw new ServiceException("工具原始输出不存在或已损坏");
        return path;
    }

    public RawOutputCapture openRawOutputCapture(String sessionId, String turnId, String toolCallId) {
        Sessions session = getSession(sessionId);
        String resultId = resultId(sessionId, turnId, toolCallId);
        Path directory = resultDirectory(session.getTranscriptUri());
        try {
            Files.createDirectories(directory);
            cleanupTemporaryFiles(directory);
            return new RawOutputCapture(directory.resolve(resultId + "." + IdUtil.fastSimpleUUID() + ".output.tmp"),
                    rawOutputPath(directory, resultId, true), rawOutputPath(directory, resultId, false));
        } catch (IOException e) {
            log.error("创建命令原始输出文件失败 sessionId:{} turnId:{} toolCallId:{}", sessionId, turnId, toolCallId, e);
            throw new ServiceException("无法创建命令原始输出文件");
        }
    }

    public void deleteResults(String transcriptUri) {
        Path directory = resultDirectory(transcriptUri);
        if (Files.notExists(directory)) return;
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted((left, right) -> right.getNameCount() - left.getNameCount()).toList()) Files.deleteIfExists(path);
        } catch (IOException e) {
            log.error("删除工具结果目录失败 path:{}", directory, e);
            throw new ServiceException("删除工具结果失败");
        }
    }

    private ToolResultArtifact getArtifact(String sessionId, String resultId) {
        validateResultId(resultId);
        Sessions session = getSession(sessionId);
        Path path = artifactPath(resultDirectory(session.getTranscriptUri()), resultId);
        if (!Files.isRegularFile(path)) throw new ServiceException("工具结果不存在");
        return readArtifact(path, sessionId, resultId);
    }

    private ToolResultArtifact readArtifact(Path path, String sessionId, String resultId) {
        try {
            ToolResultArtifact artifact = JSON.parseObject(Files.readString(path, StandardCharsets.UTF_8), ToolResultArtifact.class);
            if (artifact == null || !Objects.equals(artifact.getSchemaVersion(), SCHEMA_VERSION) || !Objects.equals(artifact.getResultId(), resultId)
                    || !Objects.equals(artifact.getSessionId(), sessionId)
                    || !Objects.equals(resultId(artifact.getSessionId(), artifact.getTurnId(), artifact.getToolCallId()), resultId)) {
                throw new ServiceException("工具结果格式错误");
            }
            return artifact;
        } catch (ServiceException e) {
            throw e;
        } catch (Exception e) {
            log.error("读取工具结果失败 path:{}", path, e);
            throw new ServiceException("工具结果不存在或已损坏");
        }
    }

    private Sessions getSession(String sessionId) {
        Sessions session = sessionsMapper.selectById(sessionId);
        if (session == null || StrUtil.isBlank(session.getTranscriptUri())) throw new ServiceException("会话不存在或未配置事件日志");
        return session;
    }

    private Path resultDirectory(String transcriptUri) {
        Path transcriptPath = sessionEventStore.resolveTranscriptPath(transcriptUri);
        Path parent = transcriptPath.getParent();
        if (parent == null) throw new ServiceException("会话事件日志路径无效");
        return parent.resolve(RESULT_DIRECTORY).normalize();
    }

    private Path artifactPath(Path directory, String resultId) {
        validateResultId(resultId);
        return directory.resolve(resultId + ".json");
    }

    private Path rawOutputPath(Path directory, String resultId, boolean complete) {
        validateResultId(resultId);
        return directory.resolve(resultId + (complete ? ".output" : ".output.partial"));
    }

    private void validateResultId(String resultId) {
        if (resultId == null || !RESULT_ID_PATTERN.matcher(resultId).matches()) throw new ServiceException("工具结果 ID 格式错误");
    }

    private boolean isJson(String text) {
        if (text.isBlank()) return false;
        try {
            JSON.parse(text);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private void writeAtomic(Path target, String content) throws IOException {
        Path temporary = target.resolveSibling(target.getFileName() + "." + IdUtil.fastSimpleUUID() + ".tmp");
        try {
            Files.writeString(temporary, content, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            moveAtomic(temporary, target);
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    private static void moveAtomic(Path source, Path target) throws IOException {
        try {
            Files.move(source, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            throw new IOException("当前文件系统不支持工具结果原子写入", e);
        }
    }

    private void cleanupTemporaryFiles(Path directory) {
        Instant cutoff = Instant.now().minus(TEMP_RETENTION);
        try (var files = Files.list(directory)) {
            files.filter(path -> path.getFileName().toString().endsWith(".tmp")).forEach(path -> deleteExpiredTemporary(path, cutoff));
        } catch (IOException e) {
            log.warn("清理工具结果临时文件失败 path:{}", directory, e);
        }
    }

    private void deleteExpiredTemporary(Path path, Instant cutoff) {
        try {
            FileTime modifiedAt = Files.getLastModifiedTime(path);
            if (modifiedAt.toInstant().isBefore(cutoff)) Files.deleteIfExists(path);
        } catch (IOException e) {
            log.warn("删除过期工具结果临时文件失败 path:{}", path, e);
        }
    }

    public static final class RawOutputCapture {
        private final Path temporaryPath;
        private final Path completePath;
        private final Path partialPath;
        private final BufferedWriter writer;
        private boolean finished;
        private boolean forceIncomplete;

        private RawOutputCapture(Path temporaryPath, Path completePath, Path partialPath) throws IOException {
            this.temporaryPath = temporaryPath;
            this.completePath = completePath;
            this.partialPath = partialPath;
            this.writer = Files.newBufferedWriter(temporaryPath, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        }

        public synchronized void append(char[] value, int offset, int length) throws IOException {
            if (finished) throw new IOException("命令原始输出捕获已结束");
            writer.write(value, offset, length);
        }

        public synchronized void finish(boolean complete) throws IOException {
            if (finished) return;
            finished = true;
            writer.close();
            moveAtomic(temporaryPath, complete && !forceIncomplete ? completePath : partialPath);
        }

        public synchronized void markIncomplete() throws IOException {
            forceIncomplete = true;
            if (finished && Files.exists(completePath)) moveAtomic(completePath, partialPath);
        }

        public synchronized void abort() {
            if (!finished) {
                finished = true;
                try {
                    writer.close();
                } catch (IOException ignored) {
                    // 删除临时文件前尽力关闭写入器。
                }
            }
            try {
                Files.deleteIfExists(temporaryPath);
            } catch (IOException ignored) {
                // 过期临时文件会在后续访问目录时清理。
            }
        }
    }
}
