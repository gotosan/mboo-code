package com.yu.mboocode.llm.tool.file;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.llm.dto.FileToolResult;

public class FileToolException extends RuntimeException {
    private final FileToolErrorCode errorCode;
    private final String userMessage;

    public FileToolException(FileToolErrorCode errorCode, String message) {
        super(resultJson(errorCode, message));
        this.errorCode = errorCode;
        this.userMessage = message;
    }

    public FileToolException(FileToolErrorCode errorCode, String message, Throwable cause) {
        super(resultJson(errorCode, message), cause);
        this.errorCode = errorCode;
        this.userMessage = message;
    }

    public FileToolErrorCode getErrorCode() {
        return errorCode;
    }

    public String toResultJson() {
        return resultJson(errorCode, userMessage);
    }

    public String getUserMessage() {
        return userMessage;
    }

    private static String resultJson(FileToolErrorCode errorCode, String message) {
        return JSON.toJSONString(FileToolResult.failed(errorCode.name(), message));
    }
}
