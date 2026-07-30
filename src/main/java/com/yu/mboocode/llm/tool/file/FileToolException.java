package com.yu.mboocode.llm.tool.file;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolErrorCode;
import com.yu.mboocode.llm.tool.ToolException;

public class FileToolException extends ToolException {
    private final ToolErrorCode errorCode;
    private final String userMessage;

    public FileToolException(ToolErrorCode errorCode, String message) {
        this(errorCode, message, null);
    }

    public FileToolException(ToolErrorCode errorCode, String message, Throwable cause) {
        super(resultJson(errorCode.getCode(), message), cause);
        this.errorCode = errorCode;
        this.userMessage = message;
    }

    public ToolErrorCode getErrorCode() {
        return errorCode;
    }

    public String toResultJson() {
        return resultJson(errorCode.getCode(), userMessage);
    }

    public String getUserMessage() {
        return userMessage;
    }

    private static String resultJson(String errorCode, String message) {
        return JSON.toJSONString(ToolResult.failed(errorCode, message));
    }
}
