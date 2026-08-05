package com.yu.mboocode.llm.context;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.tool.ToolTextTruncator;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * ChatMemory 工具压薄格式化器。
 *
 * <p>复用工具结构化结果的字段口径，把旧工具请求参数和工具结果正文改写为短小、
 * 带版本的结论 JSON。结论格式只用于 ChatMemory 内部，不进入 JSONL 工具结果契约；
 * 版本字段保证重复处理幂等。</p>
 */
@Component
public class MemoryToolConclusionFormatter {
    /**
     * 当前记忆结论版本；改写结果带有该版本号时视为已压薄，重复处理直接跳过。
     */
    public static final int MEMORY_CONCLUSION_VERSION = 1;

    private static final int COMMAND_ARGUMENT_MAX_LENGTH = 200;
    private static final int UNKNOWN_ARGUMENTS_MAX_LENGTH = 500;
    private static final int UNKNOWN_RESULT_MAX_LENGTH = 500;
    private static final int ERROR_MESSAGE_MAX_LENGTH = 500;

    @Resource
    private ToolTextTruncator toolTextTruncator;

    /**
     * 判断文本是否已经是当前版本的记忆结论。
     */
    public boolean isMemoryConclusion(String text) {
        JSONObject json = parseObject(text);
        return json != null && json.getIntValue("memoryConclusionVersion") == MEMORY_CONCLUSION_VERSION;
    }

    /**
     * 压缩工具请求参数，只保留识别该调用所需的安全字段。
     */
    public String summarizeArguments(String toolName, String argumentsJson) {
        JSONObject arguments = parseObject(argumentsJson);
        if (arguments == null) {
            return truncate(argumentsJson, UNKNOWN_ARGUMENTS_MAX_LENGTH);
        }
        Map<String, Object> safe = new LinkedHashMap<>();
        switch (toolName) {
            case "run_command" -> {
                Object command = arguments.get("command");
                if (command instanceof String text) {
                    safe.put("command", truncate(text, COMMAND_ARGUMENT_MAX_LENGTH));
                }
                copy(arguments, safe, "workdir", "timeoutMs", "description");
            }
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
                return truncate(argumentsJson, UNKNOWN_ARGUMENTS_MAX_LENGTH);
            }
        }
        return JSON.toJSONString(safe);
    }

    /**
     * 把工具结果正文改写为带版本的结论 JSON，删除输出正文、diff 和文件内容。
     */
    public String concludeResult(String toolName, String resultText) {
        if (isMemoryConclusion(resultText)) {
            return resultText;
        }
        JSONObject result = parseObject(resultText);
        Map<String, Object> conclusion = new LinkedHashMap<>();
        conclusion.put("memoryConclusionVersion", MEMORY_CONCLUSION_VERSION);
        conclusion.put("toolName", toolName);
        List<String> omitted = new java.util.ArrayList<>();

        if (result == null) {
            // 非结构化结果只保留严格限制的短文本
            conclusion.put("status", "COMPLETED");
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("result", truncate(resultText, UNKNOWN_RESULT_MAX_LENGTH));
            conclusion.put("conclusion", body);
            return JSON.toJSONString(conclusion);
        }

        String status = result.getString("status");
        conclusion.put("status", status == null || status.isBlank() ? "COMPLETED" : status);
        JSONObject data = result.getJSONObject("data");
        Map<String, Object> body = new LinkedHashMap<>();

        if ("FAILED".equals(status) || (data == null && result.getString("errorCode") != null)) {
            copy(result, body, "errorCode");
            String message = result.getString("message");
            if (message != null) {
                body.put("message", truncate(message, ERROR_MESSAGE_MAX_LENGTH));
            }
        } else if (data == null) {
            String message = result.getString("message");
            if (message != null) {
                body.put("message", truncate(message, ERROR_MESSAGE_MAX_LENGTH));
            }
        } else {
            switch (toolName) {
                case "run_command" -> {
                    copy(data, body, "exitCode", "workdir", "shell", "durationMs", "timedOut", "cancelled", "truncated", "terminationComplete");
                    omitted.add("output");
                }
                case "edit_file", "write_file" -> {
                    copy(data, body, "operation", "path", "addedLines", "deletedLines", "beforeBytes", "afterBytes", "replacements");
                    omitted.add("diff");
                }
                case "read_file" -> {
                    copy(data, body, "path", "startLine", "endLine", "totalLines", "truncated", "nextOffset");
                    omitted.add("content");
                }
                case "search_text" -> {
                    copy(data, body, "matchCount", "fileCount", "skippedBinaryFiles", "skippedEncodingFiles", "skippedLargeFiles", "skippedIgnoredFiles", "truncated");
                    omitted.add("matches");
                }
                case "glob_files" -> {
                    copy(data, body, "count", "truncated");
                    omitted.add("files");
                }
                default -> {
                    body.put("result", truncate(JSON.toJSONString(data), UNKNOWN_RESULT_MAX_LENGTH));
                    omitted.add("rawResult");
                }
            }
        }

        conclusion.put("conclusion", body);
        if (!omitted.isEmpty()) {
            conclusion.put("omitted", omitted);
        }
        return JSON.toJSONString(conclusion);
    }

    private void copy(JSONObject source, Map<String, Object> target, String... names) {
        for (String name : names) {
            if (source.containsKey(name)) {
                target.put(name, source.get(name));
            }
        }
    }

    private int stringLength(Object value) {
        return value instanceof String text ? text.length() : 0;
    }

    private JSONObject parseObject(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        try {
            return JSON.parseObject(text);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private String truncate(String text, int maxLength) {
        return toolTextTruncator.truncateMiddle(text == null ? "" : text, maxLength).text();
    }
}
