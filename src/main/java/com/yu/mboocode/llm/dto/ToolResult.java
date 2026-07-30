package com.yu.mboocode.llm.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "工具统一结果")
public record ToolResult<T>(
        @Schema(description = "是否成功") boolean success,
        @Schema(description = "执行状态") String status,
        @Schema(description = "错误码") String errorCode,
        @Schema(description = "结果说明") String message,
        @Schema(description = "结果数据") T data
) {
    public static <T> ToolResult<T> completed(T data) {
        return new ToolResult<>(true, "COMPLETED", null, null, data);
    }

    public static <T> ToolResult<T> noChanges(T data) {
        return new ToolResult<>(true, "NO_CHANGES", null, "内容无变化", data);
    }

    public static ToolResult<Void> failed(String errorCode, String message) {
        return new ToolResult<>(false, "FAILED", errorCode, message, null);
    }

    public static <T> ToolResult<T> failed(String errorCode, String message, T data) {
        return new ToolResult<>(false, "FAILED", errorCode, message, data);
    }
}
