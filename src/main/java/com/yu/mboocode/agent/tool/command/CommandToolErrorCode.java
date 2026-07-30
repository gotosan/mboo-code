package com.yu.mboocode.agent.tool.command;

import com.yu.mboocode.agent.tool.ToolErrorCode;

public enum CommandToolErrorCode implements ToolErrorCode {
    COMMAND_SHELL_NOT_FOUND,
    COMMAND_START_FAILED,
    COMMAND_EXIT_NON_ZERO,
    COMMAND_TIMEOUT,
    COMMAND_CANCELLED,
    COMMAND_INTERRUPTED,
    COMMAND_OUTPUT_READ_FAILED,
    COMMAND_TERMINATION_FAILED,
    COMMAND_EXECUTION_ERROR;

    @Override
    public String getCode() {
        return name();
    }
}
