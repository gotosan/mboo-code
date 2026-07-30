package com.yu.mboocode.agent.tool.event;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.yu.mboocode.agent.tool.ToolTextTruncator;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

@Component
public class ToolEventFormatterRegistry {
    private static final Set<String> FILE_TOOLS = Set.of("glob_files", "search_text", "read_file", "edit_file", "write_file");
    @Resource
    private ToolTextTruncator toolTextTruncator;

    public String formatArguments(String toolName, String argumentsJson) {
        if ("run_command".equals(toolName)) {
            JSONObject arguments = parseObject(argumentsJson);
            if (arguments == null) return truncate(argumentsJson, 16_500);
            Map<String, Object> commandArguments = new LinkedHashMap<>();
            copy(arguments, commandArguments, "command", "workdir", "timeoutMs", "description");
            return JSON.toJSONString(commandArguments);
        }
        if (!FILE_TOOLS.contains(toolName)) return truncate(argumentsJson, 2000);
        JSONObject arguments = parseObject(argumentsJson);
        if (arguments == null) return truncate(argumentsJson, ToolTextTruncator.EVENT_RESULT_MAX_LENGTH);
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
        if ("run_command".equals(toolName) && result != null) return new EndedFormat(formatCommand(result), errorCode, errorMessage);
        if (("edit_file".equals(toolName) || "write_file".equals(toolName)) && result != null && result.getJSONObject("data") != null) {
            return new EndedFormat(formatChange(result), errorCode, errorMessage);
        }
        int maxLength = FILE_TOOLS.contains(toolName) ? ToolTextTruncator.EVENT_RESULT_MAX_LENGTH : 2000;
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
        if (diff == null || diff.isBlank()) return truncate(summary.toString().stripTrailing(), ToolTextTruncator.EVENT_RESULT_MAX_LENGTH);
        String prefix = summary + "diff：\n";
        int maxDiff = Math.max(0, ToolTextTruncator.EVENT_RESULT_MAX_LENGTH - prefix.length());
        return prefix + toolTextTruncator.truncateMiddle(diff, maxDiff).text();
    }

    private String formatCommand(JSONObject result) {
        JSONObject data = result.getJSONObject("data");
        StringBuilder summary = new StringBuilder();
        append(summary, "状态", result.getString("status"));
        if (data == null) {
            append(summary, "错误", result.getString("message"));
            return truncate(summary.toString().stripTrailing(), ToolTextTruncator.EVENT_RESULT_MAX_LENGTH);
        }
        append(summary, "退出码", data.get("exitCode"));
        append(summary, "工作目录", data.getString("workdir"));
        append(summary, "Shell", data.getString("shell"));
        append(summary, "耗时(ms)", data.get("durationMs"));
        append(summary, "超时", data.get("timedOut"));
        append(summary, "已取消", data.get("cancelled"));
        append(summary, "输出已裁剪", data.get("truncated"));
        if (Boolean.TRUE.equals(data.getBoolean("encodingWarning"))) summary.append("输出包含无法按 UTF-8 解码的字节\n");
        if (Boolean.FALSE.equals(data.getBoolean("terminationComplete"))) summary.append("部分子进程可能仍在运行\n");
        String prefix = summary.append("输出：\n").toString();
        int maxOutput = Math.max(0, ToolTextTruncator.EVENT_RESULT_MAX_LENGTH - prefix.length());
        return prefix + toolTextTruncator.truncateMiddle(data.getString("output"), maxOutput).text();
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
        return toolTextTruncator.truncateMiddle(text == null ? "" : text, maxLength).text();
    }

    public record EndedFormat(String resultPreview, String errorCode, String errorMessage) {
    }
}
