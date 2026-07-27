package com.yu.mboocode.llm.tool.file;

import com.yu.mboocode.llm.dto.FileChangeData;
import com.yu.mboocode.llm.dto.FileToolResult;
import com.yu.mboocode.llm.tool.permission.PathKind;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.concurrent.locks.Lock;

@Component
public class EditFileTool {
    private static final int MAX_TEXT_LENGTH = 1024 * 1024;

    private final FileToolSupport fileToolSupport;
    private final TextFileSupport textFileSupport;
    private final FileDiffSupport fileDiffSupport;
    private final FilePathLock filePathLock;

    public EditFileTool(FileToolSupport fileToolSupport, TextFileSupport textFileSupport, FileDiffSupport fileDiffSupport, FilePathLock filePathLock) {
        this.fileToolSupport = fileToolSupport;
        this.textFileSupport = textFileSupport;
        this.fileDiffSupport = fileDiffSupport;
        this.filePathLock = filePathLock;
    }

    @Tool("通过精确字符串替换修改已有文本文件。修改前应先读取文件；局部修改优先使用本工具。")
    @ToolPermission(value = ToolPermissionType.WRITE, pathParam = "path", pathKind = PathKind.FILE)
    public FileToolResult<FileChangeData> edit_file(
            @P(name = "path", value = "已存在的目标文件路径") String path,
            @P(name = "oldText", value = "必须与当前文件内容精确匹配的文本") String oldText,
            @P(name = "newText", value = "替换后的文本，可以为空") String newText,
            @P(name = "replaceAll", value = "是否替换全部匹配", defaultValue = "false") Boolean replaceAll,
            @ToolMemoryId String sessionId) {
        validate(path, oldText, newText);
        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        fileToolSupport.requireWritablePath(paths);
        Lock lock = filePathLock.get(paths.target());
        lock.lock();
        try {
            fileToolSupport.requireRegularFile(paths.target());
            TextFileSupport.TextDocument document = textFileSupport.read(paths.target());
            int occurrences = countOccurrences(document.content(), oldText);
            if (occurrences == 0) throw new FileToolException(FileToolErrorCode.EDIT_TEXT_NOT_FOUND, "oldText 在当前文件中未找到");
            if (!Boolean.TRUE.equals(replaceAll) && occurrences != 1) throw new FileToolException(FileToolErrorCode.EDIT_TEXT_NOT_UNIQUE, "oldText 在当前文件中出现多次");

            String replacement = textFileSupport.normalizeContent(newText, document.newline());
            String nextContent = Boolean.TRUE.equals(replaceAll) ? document.content().replace(oldText, replacement) : replaceOnce(document.content(), oldText, replacement);
            int replacements = Boolean.TRUE.equals(replaceAll) ? occurrences : 1;
            if (nextContent.equals(document.content())) {
                FileChangeData data = new FileChangeData("NO_CHANGES", paths.target().toString(), paths.workspaceRelativePath(), 0, 0, document.byteLength(), document.byteLength(), replacements, "", false);
                return FileToolResult.noChanges(data);
            }

            byte[] nextBytes = textFileSupport.encode(nextContent, document.charset(), document.bom(), document.newline());
            FileDiffSupport.DiffResult diff = fileDiffSupport.create(diffPath(paths), document.content(), nextContent);
            textFileSupport.atomicWrite(paths.target(), nextBytes, document.fingerprint(), true);
            FileChangeData data = new FileChangeData("EDIT", paths.target().toString(), paths.workspaceRelativePath(), diff.addedLines(), diff.deletedLines(), document.byteLength(), nextBytes.length, replacements, diff.diff(), diff.truncated());
            return FileToolResult.completed(data);
        } finally {
            lock.unlock();
        }
    }

    private void validate(String path, String oldText, String newText) {
        fileToolSupport.validatePathArgument(path);
        if (oldText == null || oldText.isEmpty()) throw new FileToolException(FileToolErrorCode.INVALID_ARGUMENT, "oldText 不能为空");
        if (newText == null) throw new FileToolException(FileToolErrorCode.INVALID_ARGUMENT, "newText 不能为空，可以传空字符串");
        if (oldText.length() > MAX_TEXT_LENGTH) throw new FileToolException(FileToolErrorCode.INVALID_ARGUMENT, "oldText 不能超过 1 MiB 字符数据");
        if (newText.length() > MAX_TEXT_LENGTH) throw new FileToolException(FileToolErrorCode.INVALID_ARGUMENT, "newText 不能超过 1 MiB 字符数据");
    }

    private int countOccurrences(String content, String target) {
        int count = 0;
        int index = 0;
        while ((index = content.indexOf(target, index)) >= 0) {
            count++;
            index += target.length();
        }
        return count;
    }

    private String replaceOnce(String content, String oldText, String newText) {
        int index = content.indexOf(oldText);
        return content.substring(0, index) + newText + content.substring(index + oldText.length());
    }

    private String diffPath(FileToolSupport.WorkspacePaths paths) {
        if (paths.workspaceRelativePath() != null && !paths.workspaceRelativePath().isBlank()) return paths.workspaceRelativePath();
        Path fileName = paths.target().getFileName();
        return fileName == null ? paths.target().toString() : fileName.toString();
    }
}
