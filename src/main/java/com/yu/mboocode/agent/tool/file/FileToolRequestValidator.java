package com.yu.mboocode.agent.tool.file;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.tool.ToolCommonErrorCode;
import com.yu.mboocode.agent.tool.ToolRequestValidator;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component
public class FileToolRequestValidator implements ToolRequestValidator {
    private static final Set<String> FILE_TOOLS = Set.of("glob_files", "search_text", "read_file", "edit_file", "write_file");
    @Resource
    private FileToolSupport fileToolSupport;

    public boolean supports(String toolName) {
        return FILE_TOOLS.contains(toolName);
    }

    public void validate(String sessionId, ToolExecutionRequest request) {
        if (!supports(request.name())) return;
        JSONObject arguments = parseArguments(request.arguments());
        String path = requiredString(arguments, "path", false);
        fileToolSupport.validatePathArgument(path);
        switch (request.name()) {
            case "glob_files" -> validateGlob(arguments);
            case "search_text" -> validateSearch(arguments);
            case "read_file" -> validateRead(arguments);
            case "edit_file" -> validateEdit(arguments);
            case "write_file" -> validateWrite(arguments);
            default -> {
            }
        }
        FileToolSupport.WorkspacePaths paths = fileToolSupport.resolve(sessionId, path);
        if ("edit_file".equals(request.name()) || "write_file".equals(request.name())) {
            fileToolSupport.requireWritablePath(paths);
        } else {
            fileToolSupport.requireNotIgnored(paths.target());
        }
    }

    private JSONObject parseArguments(String json) {
        try {
            JSONObject value = JSON.parseObject(json);
            if (value == null) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "工具参数必须是 JSON 对象");
            return value;
        } catch (FileToolException e) {
            throw e;
        } catch (Exception e) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "工具参数 JSON 格式错误", e);
        }
    }

    private void validateGlob(JSONObject arguments) {
        String pattern = requiredString(arguments, "pattern", false);
        if (pattern.length() > 1024) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "pattern 长度不能超过 1024 个字符");
        integerRange(arguments, "maxResults", 1, 500);
    }

    private void validateSearch(JSONObject arguments) {
        String query = requiredString(arguments, "query", true);
        if (query.length() > 4096) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "query 长度不能超过 4096 个字符");
        String glob = optionalString(arguments, "glob");
        if (glob != null && glob.length() > 1024) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "glob 长度不能超过 1024 个字符");
        booleanType(arguments, "regex");
        booleanType(arguments, "caseSensitive");
        integerRange(arguments, "maxResults", 1, 200);
    }

    private void validateRead(JSONObject arguments) {
        integerRange(arguments, "offset", 1, Integer.MAX_VALUE);
        integerRange(arguments, "limit", 1, 1000);
    }

    private void validateEdit(JSONObject arguments) {
        String oldText = requiredString(arguments, "oldText", true);
        String newText = requiredString(arguments, "newText", true);
        if (oldText.isEmpty()) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "oldText 不能为空");
        if (oldText.length() > 1024 * 1024) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "oldText 不能超过 1 MiB 字符数据");
        if (newText.length() > 1024 * 1024) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "newText 不能超过 1 MiB 字符数据");
        booleanType(arguments, "replaceAll");
    }

    private void validateWrite(JSONObject arguments) {
        String content = requiredString(arguments, "content", true);
        if (content.length() > FileToolSupport.MAX_FILE_BYTES) throw new FileToolException(FileToolErrorCode.FILE_TOO_LARGE, "content 不能超过 10 MiB 字符数据");
        booleanType(arguments, "createParents");
    }

    private String requiredString(JSONObject arguments, String name, boolean allowEmpty) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "缺少参数：" + name);
        Object value = arguments.get(name);
        if (!(value instanceof String text)) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是字符串");
        if (!allowEmpty && text.isBlank()) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 不能为空");
        return text;
    }

    private String optionalString(JSONObject arguments, String name) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return null;
        Object value = arguments.get(name);
        if (!(value instanceof String text)) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是字符串");
        return text;
    }

    private void integerRange(JSONObject arguments, String name, int min, int max) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return;
        Object raw = arguments.get(name);
        if (!(raw instanceof Number number)) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是整数");
        long value = number.longValue();
        if (number.doubleValue() != value || value < min || value > max) throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 超出允许范围");
    }

    private void booleanType(JSONObject arguments, String name) {
        if (arguments.containsKey(name) && arguments.get(name) != null && !(arguments.get(name) instanceof Boolean)) {
            throw new FileToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是布尔值");
        }
    }
}
