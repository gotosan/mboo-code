package com.yu.mboocode.agent.tool.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "命令执行结果")
public record CommandExecutionData(
        @Schema(description = "原始命令") String command,
        @Schema(description = "规范化真实工作目录") String workdir,
        @Schema(description = "实际 Shell 身份") String shell,
        @Schema(description = "退出码") Integer exitCode,
        @Schema(description = "合并并裁剪后的输出") String output,
        @Schema(description = "执行与清理耗时，单位毫秒") Long durationMs,
        @Schema(description = "是否超时") Boolean timedOut,
        @Schema(description = "是否取消") Boolean cancelled,
        @Schema(description = "输出是否已裁剪") Boolean truncated,
        @Schema(description = "省略字符数") Long omittedCharacters,
        @Schema(description = "省略行数") Long omittedLines,
        @Schema(description = "是否替换过非法 UTF-8 字节") Boolean encodingWarning,
        @Schema(description = "是否确认进程树已全部终止") Boolean terminationComplete
) {
}
