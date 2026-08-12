package com.yu.mboocode.agent.tool.network;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.ToolException;
import com.yu.mboocode.agent.tool.dto.NetworkErrorData;
import com.yu.mboocode.agent.tool.dto.ToolResult;

public class NetworkToolException extends ToolException {
    private final NetworkToolErrorCode errorCode;
    private final String userMessage;
    private final NetworkErrorData data;

    public NetworkToolException(NetworkToolErrorCode errorCode, String message) {
        this(errorCode, message, null, null);
    }

    public NetworkToolException(NetworkToolErrorCode errorCode, String message, NetworkErrorData data) {
        this(errorCode, message, data, null);
    }

    public NetworkToolException(NetworkToolErrorCode errorCode, String message, NetworkErrorData data, Throwable cause) {
        super(resultJson(errorCode, message, data), cause);
        this.errorCode = errorCode;
        this.userMessage = message;
        this.data = data;
    }

    public NetworkToolErrorCode getErrorCode() {
        return errorCode;
    }

    public String getUserMessage() {
        return userMessage;
    }

    public NetworkErrorData getData() {
        return data;
    }

    @Override
    public String toResultJson() {
        return resultJson(errorCode, userMessage, data);
    }

    private static String resultJson(NetworkToolErrorCode errorCode, String message, NetworkErrorData data) {
        return JSON.toJSONString(ToolResult.failed(errorCode.getCode(), message, data));
    }
}
