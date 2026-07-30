package com.yu.mboocode.agent.tool.command;

import com.yu.mboocode.agent.tool.ToolCommonErrorCode;
import com.yu.mboocode.agent.tool.ToolRequestValidator;
import com.yu.mboocode.agent.tool.permission.FilePermissionUtil;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import org.springframework.stereotype.Component;

@Component
public class CommandToolRequestValidator implements ToolRequestValidator {
    @Override
    public boolean supports(String toolName) {
        return "run_command".equals(toolName);
    }

    @Override
    public void validate(String sessionId, ToolExecutionRequest request) {
        validate(CommandRequest.parse(request.arguments()));
    }

    public void validate(CommandRequest commandRequest) {
        if (commandRequest.command() == null || commandRequest.command().isBlank()) throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "command 不能为空");
        if (commandRequest.command().length() > RunCommandTool.MAX_COMMAND_LENGTH) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "command 长度不能超过 " + RunCommandTool.MAX_COMMAND_LENGTH + " 个字符");
        }
        if (commandRequest.description() != null && commandRequest.description().length() > RunCommandTool.MAX_DESCRIPTION_LENGTH) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "description 长度不能超过 " + RunCommandTool.MAX_DESCRIPTION_LENGTH + " 个字符");
        }
        if (commandRequest.timeoutMs() != null && (commandRequest.timeoutMs() < 1 || commandRequest.timeoutMs() > RunCommandTool.MAX_TIMEOUT_MS)) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_ARGUMENT, "timeoutMs 必须在 1 到 " + RunCommandTool.MAX_TIMEOUT_MS + " 之间");
        }
        if (commandRequest.workdir() != null && commandRequest.workdir().length() > FilePermissionUtil.MAX_PATH_LENGTH) {
            throw new CommandToolException(ToolCommonErrorCode.INVALID_PATH, "workdir 长度不能超过 " + FilePermissionUtil.MAX_PATH_LENGTH + " 个字符");
        }
    }
}
