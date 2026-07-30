package com.yu.mboocode.llm.tool.command;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.llm.dto.CommandExecutionData;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.ToolException;

public class CommandToolException extends ToolException {
    private final String resultJson;

    public CommandToolException(ToolCommonErrorCode errorCode, String message) {
        this(errorCode.name(), message, null, null);
    }

    public CommandToolException(CommandToolErrorCode errorCode, String message) {
        this(errorCode.name(), message, null, null);
    }

    public CommandToolException(CommandToolErrorCode errorCode, String message, CommandExecutionData data) {
        this(errorCode.name(), message, data, null);
    }

    public CommandToolException(CommandToolErrorCode errorCode, String message, Throwable cause) {
        this(errorCode.name(), message, null, cause);
    }

    private CommandToolException(String errorCode, String message, CommandExecutionData data, Throwable cause) {
        super(JSON.toJSONString(ToolResult.failed(errorCode, message, data)), cause);
        this.resultJson = getMessage();
    }

    @Override
    public String toResultJson() {
        return resultJson;
    }
}
