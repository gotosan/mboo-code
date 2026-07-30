package com.yu.mboocode.llm.tool.file;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolCommonErrorCode;
import com.yu.mboocode.llm.tool.ToolException;

public class FileToolException extends ToolException {
    private final String errorCode;
    private final FileToolErrorCode fileErrorCode;
    private final String userMessage;

    public FileToolException(FileToolErrorCode errorCode, String message) {
        this(errorCode.name(), errorCode, message, null);
    }

    public FileToolException(ToolCommonErrorCode errorCode, String message) {
        this(errorCode.name(), null, message, null);
    }

    public FileToolException(ToolCommonErrorCode errorCode, String message, Throwable cause) {
        this(errorCode.name(), null, message, cause);
    }

    private FileToolException(String errorCode, FileToolErrorCode fileErrorCode, String message, Throwable cause) {
        super(resultJson(errorCode, message), cause);
        this.errorCode = errorCode;
        this.fileErrorCode = fileErrorCode;
        this.userMessage = message;
    }

    public FileToolException(FileToolErrorCode errorCode, String message, Throwable cause) {
        this(errorCode.name(), errorCode, message, cause);
    }

    public FileToolErrorCode getErrorCode() {
        return fileErrorCode;
    }

    public String getErrorCodeValue() {
        return errorCode;
    }

    public String toResultJson() {
        return resultJson(errorCode, userMessage);
    }

    public String getUserMessage() {
        return userMessage;
    }

    private static String resultJson(String errorCode, String message) {
        return JSON.toJSONString(ToolResult.failed(errorCode, message));
    }
}
