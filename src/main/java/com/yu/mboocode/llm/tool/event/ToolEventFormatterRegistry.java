package com.yu.mboocode.llm.tool.event;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.yu.mboocode.llm.tool.file.FileDiffSupport;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Component
public class ToolEventFormatterRegistry {
    private static final Set<String> FILE_TOOLS = Set.of("glob_files", "search_text", "read_file", "edit_file", "write_file");
    private final FileDiffSupport fileDiffSupport;

    public ToolEventFormatterRegistry(FileDiffSupport fileDiffSupport) {
        this.fileDiffSupport = fileDiffSupport;
    }

    public String formatArguments(String toolName, String argumentsJson) {
        if (!FILE_TOOLS.contains(toolName)) return truncate(argumentsJson, 2000);
        JSONObject arguments = parseObject(argumentsJson);
        if (arguments == null) return truncate(argumentsJson, FileDiffSupport.EVENT_RESULT_MAX_LENGTH);
        Map<String, Object> safe = new LinkedHashMap<>();
        switch (toolName) {
            case "glob_files" -> copy(arguments, safe, "pattern", "path", "maxResults");
            case "search_text" -> copy(arguments, safe, "query", "path", "glob", "regex", "caseSensitive", "maxResults");
            case "read_file" -> copy(arguments, safe, "path", "offset", "limit");
            case "edit_file" -> {
                copy(arguments, safe, "path");
                safe.put("oldTextLength", stringLength(arguments.get("oldText")));
                safe.put("newTextLength", stringLength(arguments.get("newText")));
                copy(arguments, safe, "replaceAll");
            }
            case "write_file" -> {
                copy(arguments, safe, "path");
                safe.put("contentLength", stringLength(arguments.get("content")));
                copy(arguments, safe, "createParents");
            }
            default -> {
            }
        }
        return JSON.toJSONString(safe);
    }

    public EndedFormat formatEnded(String toolName, String resultText, boolean failed) {
        JSONObject result = parseObject(resultText);
        String errorCode = result == null ? null : result.getString("errorCode");
        String errorMessage = result == null ? null : result.getString("message");
        if (("edit_file".equals(toolName) || "write_file".equals(toolName)) && result != null && result.getJSONObject("data") != null) {
            return new EndedFormat(formatChange(result), errorCode, errorMessage);
        }
        int maxLength = FILE_TOOLS.contains(toolName) ? FileDiffSupport.EVENT_RESULT_MAX_LENGTH : 2000;
        String preview = result == null ? truncate(resultText, maxLength) : truncate(JSON.toJSONString(result, JSONWriter.Feature.PrettyFormat), maxLength);
        if (failed && (errorMessage == null || errorMessage.isBlank())) errorMessage = preview;
        return new EndedFormat(preview, errorCode, errorMessage);
    }

    private String formatChange(JSONObject result) {
        JSONObject data = result.getJSONObject("data");
        StringBuilder summary = new StringBuilder();
        append(summary, "状态", result.getString("status"));
        append(summary, "操作", data.getString("operation"));
        append(summary, "路径", data.getString("path"));
        if (data.get("addedLines") != null) append(summary, "新增行数", data.get("addedLines"));
        if (data.get("deletedLines") != null) append(summary, "删除行数", data.get("deletedLines"));
        if (data.get("beforeBytes") != null) append(summary, "修改前字节数", data.get("beforeBytes"));
        if (data.get("afterBytes") != null) append(summary, "修改后字节数", data.get("afterBytes"));
        if (data.get("replacements") != null) append(summary, "替换次数", data.get("replacements"));
        String diff = data.getString("diff");
        if (diff == null || diff.isBlank()) return truncate(summary.toString().stripTrailing(), FileDiffSupport.EVENT_RESULT_MAX_LENGTH);
        String prefix = summary + "diff：\n";
        int maxDiff = Math.max(0, FileDiffSupport.EVENT_RESULT_MAX_LENGTH - prefix.length());
        return prefix + fileDiffSupport.truncateMiddle(diff, maxDiff).text();
    }

    private void append(StringBuilder text, String label, Object value) {
        if (value != null) text.append(label).append('：').append(value).append('\n');
    }

    private void copy(JSONObject source, Map<String, Object> target, String... names) {
        for (String name : names) {
            if (source.containsKey(name)) target.put(name, source.get(name));
        }
    }

    private int stringLength(Object value) {
        return value instanceof String text ? text.length() : 0;
    }

    private JSONObject parseObject(String text) {
        if (text == null || text.isBlank()) return null;
        try {
            return JSON.parseObject(text);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private String truncate(String text, int maxLength) {
        return fileDiffSupport.truncateMiddle(text == null ? "" : text, maxLength).text();
    }

    public record EndedFormat(String resultPreview, String errorCode, String errorMessage) {
    }
}
