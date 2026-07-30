package com.yu.mboocode.llm.tool.file;

import com.yu.mboocode.llm.dto.FilePathItem;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.dto.GlobFilesData;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.permission.PathKind;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import org.springframework.stereotype.Component;

import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Component
public class GlobFilesTool {
    private static final int DEFAULT_MAX_RESULTS = 100;
    private static final int MAX_RESULTS = 500;
    private static final int MAX_PATTERN_LENGTH = 1024;
    private static final List<String> DEFAULT_EXCLUDES = List.of("!.git/**", "!node_modules/**", "!.gradle/**", "!build/**", "!target/**", "!dist/**");

    private final FileToolSupport fileToolSupport;
    private final RgExecutor rgExecutor;

    public GlobFilesTool(FileToolSupport fileToolSupport, RgExecutor rgExecutor) {
        this.fileToolSupport = fileToolSupport;
        this.rgExecutor = rgExecutor;
    }

    @Tool("按 glob 模式查找普通文件。搜索工作区根目录时 path 必须传入 .，结果截断后应缩小搜索范围。")
    @ToolPermission(value = ToolPermissionType.READ, pathParam = "path", pathKind = PathKind.DIRECTORY)
    public ToolResult<GlobFilesData> glob_files(
            @P(name = "pattern", value = "相对于 path 的 glob 模式，支持 *、**、? 和 {java,kt}") String pattern,
            @P(name = "path", value = "搜索起点目录，支持工作区相对路径或绝对路径") String path,
            @P(name = "maxResults", value = "最大结果数量，默认 100，最大 500", defaultValue = "100") Integer maxResults,
            @ToolMemoryId String sessionId) {
        validate(pattern, path, maxResults);
        int limit = maxResults == null ? DEFAULT_MAX_RESULTS : maxResults;
        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        fileToolSupport.requireNotIgnored(paths.target());
        fileToolSupport.requireDirectory(paths.target());

        List<String> arguments = new ArrayList<>();
        arguments.add("--files");
        arguments.add("--hidden");
        arguments.add("--glob");
        arguments.add(pattern);
        addIgnoreGlobs(arguments);
        arguments.add(paths.target().toString());
        RgExecutor.RgResult rgResult = rgExecutor.execute(arguments, FileToolErrorCode.INVALID_GLOB);

        List<Path> matched = new ArrayList<>();
        for (String line : rgResult.stdout().split("\\R")) {
            if (line.isBlank()) continue;
            try {
                Path candidate = Path.of(line);
                if (!candidate.isAbsolute()) candidate = paths.target().resolve(candidate);
                Path normalized = candidate.toAbsolutePath().normalize();
                if (!Files.isRegularFile(normalized) || Files.isSymbolicLink(normalized)) continue;
                Path real = normalized.toRealPath();
                if (!normalized.equals(real) || fileToolSupport.ignoredFileMatcher().isIgnored(real)) continue;
                matched.add(real);
            } catch (Exception ignored) {
                // 搜索期间消失或无法可靠解析的路径不进入结果。
            }
        }
        matched.sort(Comparator.comparing(Path::toString));
        boolean truncated = matched.size() > limit;
        List<FilePathItem> files = matched.stream().limit(limit)
                .map(file -> new FilePathItem(file.toString(), com.yu.mboocode.llm.tool.permission.FilePermissionUtil.workspaceRelativePath(file, paths.workspace())))
                .toList();
        return ToolResult.completed(new GlobFilesData(files, files.size(), truncated));
    }

    private void validate(String pattern, String path, Integer maxResults) {
        fileToolSupport.validatePathArgument(path);
        if (pattern == null || pattern.isBlank()) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "pattern 不能为空");
        if (pattern.length() > MAX_PATTERN_LENGTH) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "pattern 长度不能超过 1024 个字符");
        int limit = maxResults == null ? DEFAULT_MAX_RESULTS : maxResults;
        if (limit < 1 || limit > MAX_RESULTS) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "maxResults 必须在 1 到 500 之间");
        try {
            Path.of(path);
        } catch (InvalidPathException e) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_PATH, "路径格式错误", e);
        }
    }

    private void addIgnoreGlobs(List<String> arguments) {
        for (String glob : DEFAULT_EXCLUDES) {
            arguments.add("--glob");
            arguments.add(glob);
        }
        for (String glob : fileToolSupport.ignoredFileMatcher().ignoredRgGlobs()) {
            arguments.add("--glob");
            arguments.add("!" + glob);
        }
        for (String glob : fileToolSupport.ignoredFileMatcher().exceptionRgGlobs()) {
            arguments.add("--glob");
            arguments.add(glob);
        }
    }
}
