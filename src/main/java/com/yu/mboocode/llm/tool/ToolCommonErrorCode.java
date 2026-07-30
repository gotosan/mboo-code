package com.yu.mboocode.llm.tool;

public enum ToolCommonErrorCode implements ToolErrorCode {
    INVALID_ARGUMENT,
    INVALID_PATH,
    PATH_NOT_FOUND,
    PATH_NOT_DIRECTORY;

    @Override
    public String getCode() {
        return name();
    }
}
