package com.yu.mboocode.llm.tool.file;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.dto.SearchTextData;
import com.yu.mboocode.llm.dto.SearchTextMatch;
import com.yu.mboocode.llm.tool.permission.FilePermissionUtil;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Component
public class SearchTextTool {
    private static final int DEFAULT_MAX_RESULTS = 50;
    private static final int MAX_RESULTS = 200;
    private static final int MAX_QUERY_LENGTH = 4096;
    private static final int MAX_GLOB_LENGTH = 1024;
    private static final int MAX_LINE_TEXT = 300;
    private static final int MAX_RESULT_CHARACTERS = 40_000;
    private static final List<String> DEFAULT_EXCLUDES = List.of("!.git/**", "!node_modules/**", "!.gradle/**", "!build/**", "!target/**", "!dist/**");

    private final FileToolSupport fileToolSupport;
    private final RgExecutor rgExecutor;
    private final TextFileSupport textFileSupport;

    public SearchTextTool(FileToolSupport fileToolSupport, RgExecutor rgExecutor, TextFileSupport textFileSupport) {
        this.fileToolSupport = fileToolSupport;
        this.rgExecutor = rgExecutor;
        this.textFileSupport = textFileSupport;
    }

    @Tool("在目录内搜索单行文本。默认按普通文本精确搜索；regex=true 时使用 ripgrep 的 Rust 正则引擎。")
    @ToolPermission(value = ToolPermissionType.READ, pathParam = "path", pathKind = PathKind.DIRECTORY)
    public ToolResult<SearchTextData> search_text(
            @P(name = "query", value = "普通文本或正则表达式") String query,
            @P(name = "path", value = "搜索起点目录，支持工作区相对路径或绝对路径") String path,
            @P(name = "glob", value = "可选文件过滤 glob", defaultValue = "") String glob,
            @P(name = "regex", value = "是否使用正则表达式", defaultValue = "false") Boolean regex,
            @P(name = "caseSensitive", value = "是否区分大小写", defaultValue = "true") Boolean caseSensitive,
            @P(name = "maxResults", value = "最大匹配行数，默认 50，最大 200", defaultValue = "50") Integer maxResults,
            @ToolMemoryId String sessionId) {
        validate(query, path, glob, maxResults);
        boolean regexSearch = Boolean.TRUE.equals(regex);
        boolean sensitive = caseSensitive == null || caseSensitive;
        int limit = maxResults == null ? DEFAULT_MAX_RESULTS : maxResults;
        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        fileToolSupport.requireNotIgnored(paths.target());
        fileToolSupport.requireDirectory(paths.target());
        FileClassification classification = classifyFiles(paths, glob);

        List<String> arguments = new ArrayList<>();
        arguments.add("--json");
        arguments.add("--hidden");
        arguments.add("--max-filesize");
        arguments.add("10M");
        if (!regexSearch) arguments.add("--fixed-strings");
        if (!sensitive) arguments.add("--ignore-case");
        if (glob != null && !glob.isBlank()) {
            arguments.add("--glob");
            arguments.add(glob);
        }
        addIgnoreGlobs(arguments);
        arguments.add("--");
        arguments.add(query);
        arguments.add(paths.target().toString());
        RgExecutor.RgResult rgResult = rgExecutor.execute(arguments, regexSearch ? FileToolErrorCode.INVALID_REGEX : null);

        List<SearchTextMatch> matches = new ArrayList<>();
        Set<String> files = new LinkedHashSet<>();
        Set<String> ignoredFiles = new HashSet<>();
        int characters = 0;
        boolean truncated = false;
        for (String jsonLine : rgResult.stdout().split("\\R")) {
            if (jsonLine.isBlank()) continue;
            JSONObject event;
            try {
                event = JSON.parseObject(jsonLine);
            } catch (RuntimeException ignored) {
                continue;
            }
            if (!"match".equals(event.getString("type"))) continue;
            JSONObject data = event.getJSONObject("data");
            JSONObject pathData = data == null ? null : data.getJSONObject("path");
            JSONObject linesData = data == null ? null : data.getJSONObject("lines");
            JSONArray submatches = data == null ? null : data.getJSONArray("submatches");
            if (pathData == null || linesData == null || submatches == null || submatches.isEmpty()) continue;
            Path matchedPath = Path.of(pathData.getString("text"));
            if (!matchedPath.isAbsolute()) matchedPath = paths.target().resolve(matchedPath);
            try {
                Path normalized = matchedPath.toAbsolutePath().normalize();
                if (!Files.isRegularFile(normalized) || Files.isSymbolicLink(normalized)) continue;
                Path real = normalized.toRealPath();
                if (!normalized.equals(real)) continue;
                if (!classification.searchableFiles().contains(real.toString())) continue;
                if (fileToolSupport.ignoredFileMatcher().isIgnored(real)) {
                    ignoredFiles.add(real.toString());
                    continue;
                }
                String line = stripLineEnding(linesData.getString("text"));
                JSONObject first = submatches.getJSONObject(0);
                int byteStart = first.getIntValue("start");
                int byteEnd = first.getIntValue("end");
                int start = byteOffsetToCharIndex(line, byteStart);
                int end = byteOffsetToCharIndex(line, byteEnd);
                Snippet snippet = snippet(line, start, end);
                SearchTextMatch match = new SearchTextMatch(real.toString(), FilePermissionUtil.workspaceRelativePath(real, paths.workspace()), data.getIntValue("line_number"), snippet.text(), snippet.matchStart(), snippet.matchEnd());
                int nextCharacters = characters + match.path().length() + match.lineText().length() + 40;
                if (matches.size() >= limit || nextCharacters > MAX_RESULT_CHARACTERS) {
                    truncated = true;
                    break;
                }
                matches.add(match);
                files.add(real.toString());
                characters = nextCharacters;
            } catch (Exception ignored) {
                // 搜索期间变化或无法解析的文件不进入结果。
            }
        }
        matches.sort(Comparator.comparing(SearchTextMatch::path).thenComparingInt(SearchTextMatch::lineNumber));
        int skippedIgnored = Math.max(classification.skippedIgnoredFiles(), ignoredFiles.size());
        SearchTextData data = new SearchTextData(matches, matches.size(), files.size(), classification.skippedBinaryFiles(), classification.skippedEncodingFiles(), classification.skippedLargeFiles(), skippedIgnored, truncated);
        return ToolResult.completed(data);
    }

    private void validate(String query, String path, String glob, Integer maxResults) {
        fileToolSupport.validatePathArgument(path);
        if (query == null || query.isEmpty()) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "query 不能为空");
        if (query.length() > MAX_QUERY_LENGTH) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "query 长度不能超过 4096 个字符");
        if (glob != null && glob.length() > MAX_GLOB_LENGTH) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "glob 长度不能超过 1024 个字符");
        int limit = maxResults == null ? DEFAULT_MAX_RESULTS : maxResults;
        if (limit < 1 || limit > MAX_RESULTS) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "maxResults 必须在 1 到 200 之间");
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

    private FileClassification classifyFiles(FileToolSupport.WorkspacePaths paths, String glob) {
        List<String> arguments = new ArrayList<>();
        arguments.add("--files");
        arguments.add("--hidden");
        if (glob != null && !glob.isBlank()) {
            arguments.add("--glob");
            arguments.add(glob);
        }
        for (String exclude : DEFAULT_EXCLUDES) {
            arguments.add("--glob");
            arguments.add(exclude);
        }
        arguments.add(paths.target().toString());
        RgExecutor.RgResult filesResult = rgExecutor.execute(arguments, FileToolErrorCode.INVALID_GLOB);
        Set<String> searchable = new HashSet<>();
        Set<String> binary = new HashSet<>();
        Set<String> encoding = new HashSet<>();
        Set<String> large = new HashSet<>();
        Set<String> ignored = new HashSet<>();
        for (String line : filesResult.stdout().split("\\R")) {
            if (line.isBlank()) continue;
            try {
                Path candidate = Path.of(line);
                if (!candidate.isAbsolute()) candidate = paths.target().resolve(candidate);
                Path normalized = candidate.toAbsolutePath().normalize();
                if (!Files.isRegularFile(normalized) || Files.isSymbolicLink(normalized)) continue;
                Path real = normalized.toRealPath();
                if (!normalized.equals(real)) continue;
                String file = real.toString();
                if (fileToolSupport.ignoredFileMatcher().isIgnored(normalized) || fileToolSupport.ignoredFileMatcher().isIgnored(real)) {
                    ignored.add(file);
                    continue;
                }
                if (Files.size(real) > FileToolSupport.MAX_FILE_BYTES) {
                    large.add(file);
                    continue;
                }
                try {
                    textFileSupport.read(real);
                    searchable.add(file);
                } catch (FileToolException e) {
                    if (e.getErrorCode() == FileToolErrorCode.BINARY_FILE) binary.add(file);
                    else if (e.getErrorCode() == FileToolErrorCode.UNSUPPORTED_ENCODING) encoding.add(file);
                    else if (e.getErrorCode() == FileToolErrorCode.FILE_TOO_LARGE) large.add(file);
                }
            } catch (Exception ignoredException) {
                // 搜索期间消失或无法可靠解析的文件不进入分类结果。
            }
        }
        return new FileClassification(searchable, binary.size(), encoding.size(), large.size(), ignored.size());
    }

    private int byteOffsetToCharIndex(String line, int offset) {
        byte[] bytes = line.getBytes(StandardCharsets.UTF_8);
        int safeOffset = Math.max(0, Math.min(offset, bytes.length));
        return new String(bytes, 0, safeOffset, StandardCharsets.UTF_8).length();
    }

    private Snippet snippet(String line, int matchStart, int matchEnd) {
        if (line.length() <= MAX_LINE_TEXT) return new Snippet(line, matchStart, matchEnd);
        int matchLength = Math.max(1, matchEnd - matchStart);
        boolean prefixOmitted = matchStart > 0;
        boolean suffixOmitted = matchEnd < line.length();
        int markerLength = (prefixOmitted ? 1 : 0) + (suffixOmitted ? 1 : 0);
        int available = Math.max(0, MAX_LINE_TEXT - matchLength - markerLength);
        int start = Math.max(0, matchStart - available / 2);
        int contentLength = MAX_LINE_TEXT - markerLength;
        int end = Math.min(line.length(), start + contentLength);
        start = Math.max(0, end - contentLength);
        String prefix = start > 0 ? "…" : "";
        String suffix = end < line.length() ? "…" : "";
        String text = prefix + line.substring(start, end) + suffix;
        int adjustedStart = prefix.length() + matchStart - start;
        return new Snippet(text, adjustedStart, Math.min(text.length(), adjustedStart + matchLength));
    }

    private String stripLineEnding(String value) {
        if (value == null) return "";
        if (value.endsWith("\r\n")) return value.substring(0, value.length() - 2);
        if (value.endsWith("\n") || value.endsWith("\r")) return value.substring(0, value.length() - 1);
        return value;
    }

    private record Snippet(String text, int matchStart, int matchEnd) {
    }

    private record FileClassification(Set<String> searchableFiles, int skippedBinaryFiles, int skippedEncodingFiles, int skippedLargeFiles, int skippedIgnoredFiles) {
    }
}
