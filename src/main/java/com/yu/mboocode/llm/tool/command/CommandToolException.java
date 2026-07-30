package com.yu.mboocode.llm.tool.command;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.llm.dto.CommandExecutionData;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolErrorCode;
import com.yu.mboocode.llm.tool.ToolException;

public class CommandToolException extends ToolException {
    private final String resultJson;

    public CommandToolException(ToolErrorCode errorCode, String message) {
        this(errorCode, message, null, null);
    }

    public CommandToolException(ToolErrorCode errorCode, String message, CommandExecutionData data) {
        this(errorCode, message, data, null);
    }

    public CommandToolException(ToolErrorCode errorCode, String message, Throwable cause) {
        this(errorCode, message, null, cause);
    }

    private CommandToolException(ToolErrorCode errorCode, String message, CommandExecutionData data, Throwable cause) {
        super(JSON.toJSONString(ToolResult.failed(errorCode.getCode(), message, data)), cause);
        this.resultJson = getMessage();
    }

    @Override
    public String toResultJson() {
        return resultJson;
    }
}
