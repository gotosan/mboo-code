package com.yu.mboocode.llm.tool.file;

import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.dto.ReadFileData;
import com.yu.mboocode.llm.tool.permission.PathKind;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ReadFileTool {
    private static final int DEFAULT_LIMIT = 300;
    private static final int MAX_LIMIT = 1000;
    private static final int MAX_CONTENT_LENGTH = 32_000;
    private static final int MAX_LINE_LENGTH = 2000;

    @Resource
    private FileToolSupport fileToolSupport;
    @Resource
    private TextFileSupport textFileSupport;

    @Tool("分页读取普通文本文件并返回带行号内容。结果截断时使用 nextOffset 继续读取。")
    @ToolPermission(value = ToolPermissionType.READ, pathParam = "path", pathKind = PathKind.FILE)
    public ToolResult<ReadFileData> read_file(
            @P(name = "path", value = "目标文件路径，支持工作区相对路径或绝对路径") String path,
            @P(name = "offset", value = "起始行，从 1 开始", defaultValue = "1") Integer offset,
            @P(name = "limit", value = "最大读取行数，默认 300，最大 1000", defaultValue = "300") Integer limit,
            @ToolMemoryId String sessionId) {
        fileToolSupport.validatePathArgument(path);
        int start = offset == null ? 1 : offset;
        int maxLines = limit == null ? DEFAULT_LIMIT : limit;
        if (start < 1) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "offset 必须大于等于 1");
        if (maxLines < 1 || maxLines > MAX_LIMIT) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "limit 必须在 1 到 1000 之间");

        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        fileToolSupport.requireNotIgnored(paths.target());
        fileToolSupport.requireRegularFile(paths.target());
        TextFileSupport.TextDocument document = textFileSupport.read(paths.target());
        List<String> lines = textFileSupport.lines(document.content());
        int index = Math.min(start - 1, lines.size());
        int requestedEnd = Math.min(lines.size(), index + maxLines);
        StringBuilder content = new StringBuilder();
        int endIndex = index;
        while (endIndex < requestedEnd) {
            String line = truncateLine(lines.get(endIndex));
            String rendered = String.format("%6d| %s", endIndex + 1, line);
            int extra = rendered.length() + (content.isEmpty() ? 0 : 1);
            if (content.length() + extra > MAX_CONTENT_LENGTH) break;
            if (!content.isEmpty()) content.append('\n');
            content.append(rendered);
            endIndex++;
        }
        boolean truncated = endIndex < lines.size();
        Integer nextOffset = truncated ? endIndex + 1 : null;
        int startLine = index < lines.size() ? index + 1 : start;
        int endLine = endIndex > index ? endIndex : 0;
        ReadFileData data = new ReadFileData(paths.target().toString(), paths.workspaceRelativePath(), startLine, endLine, lines.size(), content.toString(), truncated, nextOffset);
        return ToolResult.completed(data);
    }

    private String truncateLine(String line) {
        if (line.length() <= MAX_LINE_LENGTH) return line;
        int omitted = line.length() - MAX_LINE_LENGTH;
        String marker = "...（单行已截断，省略 " + omitted + " 个字符）...";
        int contentLength = Math.max(0, MAX_LINE_LENGTH - marker.length());
        omitted = line.length() - contentLength;
        marker = "...（单行已截断，省略 " + omitted + " 个字符）...";
        contentLength = Math.max(0, MAX_LINE_LENGTH - marker.length());
        return line.substring(0, contentLength) + marker;
    }
}
