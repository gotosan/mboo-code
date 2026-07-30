package com.yu.mboocode.llm.tool.command;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;

public record CommandRequest(String command, String workdir, Long timeoutMs, String description) {
    public static CommandRequest parse(String argumentsJson) {
        try {
            JSONObject arguments = JSON.parseObject(argumentsJson);
            if (arguments == null) throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "工具参数必须是 JSON 对象");
            Object rawCommand = arguments.get("command");
            if (!(rawCommand instanceof String command)) throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 command 必须是字符串");
            String workdir = optionalString(arguments, "workdir");
            String description = optionalString(arguments, "description");
            Long timeoutMs = optionalLong(arguments, "timeoutMs");
            return new CommandRequest(command, workdir, timeoutMs, description);
        } catch (CommandToolException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "工具参数 JSON 格式错误");
        }
    }

    public long effectiveTimeoutMs() {
        return timeoutMs == null ? RunCommandTool.DEFAULT_TIMEOUT_MS : timeoutMs;
    }

    private static String optionalString(JSONObject arguments, String name) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return null;
        Object value = arguments.get(name);
        if (!(value instanceof String text)) throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是字符串");
        return text;
    }

    private static Long optionalLong(JSONObject arguments, String name) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return null;
        Object value = arguments.get(name);
        if (!(value instanceof Number number) || number.doubleValue() != number.longValue()) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "参数 " + name + " 必须是整数");
        }
        return number.longValue();
    }
}
