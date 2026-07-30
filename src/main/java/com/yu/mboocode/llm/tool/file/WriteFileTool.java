package com.yu.mboocode.llm.tool.file;

import com.yu.mboocode.llm.dto.FileChangeData;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.permission.PathKind;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.locks.Lock;

@Component
public class WriteFileTool {
    private final FileToolSupport fileToolSupport;
    private final TextFileSupport textFileSupport;
    private final FileDiffSupport fileDiffSupport;
    private final FilePathLock filePathLock;

    public WriteFileTool(FileToolSupport fileToolSupport, TextFileSupport textFileSupport, FileDiffSupport fileDiffSupport, FilePathLock filePathLock) {
        this.fileToolSupport = fileToolSupport;
        this.textFileSupport = textFileSupport;
        this.fileDiffSupport = fileDiffSupport;
        this.filePathLock = filePathLock;
    }

    @Tool("创建新文本文件或完整覆盖已有文本文件。已有文件的局部修改应优先使用 edit_file。")
    @ToolPermission(value = ToolPermissionType.WRITE, pathParam = "path", pathKind = PathKind.FILE)
    public ToolResult<FileChangeData> write_file(
            @P(name = "path", value = "目标文件路径") String path,
            @P(name = "content", value = "完整文件内容，可以为空") String content,
            @P(name = "createParents", value = "是否创建缺失的父目录", defaultValue = "false") Boolean createParents,
            @ToolMemoryId String sessionId) {
        validate(path, content);
        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        fileToolSupport.requireWritablePath(paths);
        Lock lock = filePathLock.get(paths.target());
        lock.lock();
        try {
            Path parent = paths.target().getParent();
            if (parent == null) throw new FileToolException(ToolCommonErrorCode.INVALID_PATH, "无法解析目标文件父目录");
            if (Files.notExists(parent)) {
                if (!Boolean.TRUE.equals(createParents)) throw new FileToolException(ToolCommonErrorCode.PATH_NOT_FOUND, "父目录不存在，若需创建请设置 createParents=true");
                createParents(parent);
            }
            if (!Files.isDirectory(parent)) throw new FileToolException(ToolCommonErrorCode.PATH_NOT_DIRECTORY, "目标文件父路径不是目录");

            boolean exists = Files.exists(paths.target());
            if (exists && !Files.isRegularFile(paths.target())) throw new FileToolException(FileToolErrorCode.PATH_NOT_REGULAR_FILE, "目标路径不是普通文件");
            if (exists) return overwrite(paths, content);
            return create(paths, content);
        } finally {
            lock.unlock();
        }
    }

    private ToolResult<FileChangeData> overwrite(FileToolSupport.WorkspacePaths paths, String content) {
        TextFileSupport.TextDocument document = textFileSupport.read(paths.target());
        String nextContent = textFileSupport.normalizeContent(content, document.newline());
        byte[] nextBytes = textFileSupport.encode(nextContent, document.charset(), document.bom(), document.newline());
        if (nextContent.equals(document.content())) {
            FileChangeData data = new FileChangeData("NO_CHANGES", paths.target().toString(), paths.workspaceRelativePath(), 0, 0, document.byteLength(), document.byteLength(), null, "", false);
            return ToolResult.noChanges(data);
        }
        FileDiffSupport.DiffResult diff = fileDiffSupport.create(diffPath(paths), document.content(), nextContent);
        textFileSupport.atomicWrite(paths.target(), nextBytes, document.fingerprint(), true);
        FileChangeData data = new FileChangeData("OVERWRITE", paths.target().toString(), paths.workspaceRelativePath(), diff.addedLines(), diff.deletedLines(), document.byteLength(), nextBytes.length, null, diff.diff(), diff.truncated());
        return ToolResult.completed(data);
    }

    private ToolResult<FileChangeData> create(FileToolSupport.WorkspacePaths paths, String content) {
        String nextContent = textFileSupport.normalizeContent(content, "\n");
        byte[] nextBytes = textFileSupport.encode(nextContent, StandardCharsets.UTF_8, new byte[0], "\n");
        FileDiffSupport.DiffResult diff = fileDiffSupport.create(diffPath(paths), "", nextContent);
        textFileSupport.atomicWrite(paths.target(), nextBytes, textFileSupport.missingFingerprint(), false);
        FileChangeData data = new FileChangeData("CREATE", paths.target().toString(), paths.workspaceRelativePath(), diff.addedLines(), diff.deletedLines(), 0, nextBytes.length, null, diff.diff(), diff.truncated());
        return ToolResult.completed(data);
    }

    private void createParents(Path parent) {
        try {
            Path planned = parent.toAbsolutePath().normalize();
            Files.createDirectories(parent);
            Path actual = parent.toRealPath();
            if (!planned.equals(actual)) throw new FileToolException(FileToolErrorCode.FILE_CHANGED, "父目录在创建期间发生变化");
        } catch (FileToolException e) {
            throw e;
        } catch (Exception e) {
            throw new FileToolException(FileToolErrorCode.FILE_WRITE_FAILED, "创建父目录失败", e);
        }
    }

    private void validate(String path, String content) {
        fileToolSupport.validatePathArgument(path);
        if (content == null) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "content 不能为空，可以传空字符串");
        if (content.length() > FileToolSupport.MAX_FILE_BYTES) throw new FileToolException(FileToolErrorCode.FILE_TOO_LARGE, "content 不能超过 10 MiB 字符数据");
    }

    private String diffPath(FileToolSupport.WorkspacePaths paths) {
        if (paths.workspaceRelativePath() != null && !paths.workspaceRelativePath().isBlank()) return paths.workspaceRelativePath();
        Path fileName = paths.target().getFileName();
        return fileName == null ? paths.target().toString() : fileName.toString();
    }
}
