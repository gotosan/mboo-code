package com.yu.mboocode.llm.tool.command;

import com.yu.mboocode.llm.dto.CommandExecutionData;
import com.yu.mboocode.llm.dto.ToolResult;
import com.yu.mboocode.llm.tool.ToolInvocationContext;
import com.yu.mboocode.llm.tool.permission.ToolPermission;
import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

@Component
public class RunCommandTool {
    public static final int MAX_COMMAND_LENGTH = 16_000;
    public static final int MAX_DESCRIPTION_LENGTH = 200;
    public static final long DEFAULT_TIMEOUT_MS = 120_000;
    public static final long MAX_TIMEOUT_MS = 600_000;
    public static final int MAX_OUTPUT_CHARACTERS = 32_000;
    public static final int MAX_OUTPUT_LINES = 2_000;

    @Resource
    private CommandResolver commandResolver;
    @Resource
    private CommandExecutor commandExecutor;
    @Resource
    private CommandToolRequestValidator requestValidator;

    @Tool("执行前台非交互 Shell 命令并等待结束。默认工作目录是会话工作区，stdin 会立即收到 EOF，超长输出保留头尾并裁剪中间内容。不要在命令中内联密码、Token 或其他密钥；长脚本应先写入工作区文件再执行。")
    @ToolPermission(ToolPermissionType.COMMAND)
    public ToolResult<CommandExecutionData> run_command(
            @P(name = "command", value = "传给 Shell 的完整原始命令，1 至 16000 字符") String command,
            @P(name = "workdir", value = "启动目录，默认为会话工作区") String workdir,
            @P(name = "timeoutMs", value = "命令超时毫秒数，默认 120000，最大 600000", defaultValue = "120000") Long timeoutMs,
            @P(name = "description", value = "模型提供的用途说明，最多 200 字符") String description,
            @ToolMemoryId String sessionId) {
        CommandRequest request = new CommandRequest(command, workdir, timeoutMs, description);
        requestValidator.validate(request);
        ResolvedCommand resolved = commandResolver.resolve(sessionId, request);
        ToolInvocationContext.Value context = ToolInvocationContext.current();
        String toolCallId = context == null || context.toolCallId() == null ? "direct-" + Thread.currentThread().threadId() : context.toolCallId();
        String turnId = context == null ? null : context.turnId();
        CommandExecutionData data = commandExecutor.execute(sessionId, turnId, toolCallId, resolved);
        return ToolResult.completed(data);
    }

}
