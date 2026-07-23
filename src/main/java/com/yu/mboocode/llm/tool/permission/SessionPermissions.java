package com.yu.mboocode.llm.tool.permission;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * 会话权限数据，保存在 Sessions.metadataJson.permissions。
 */
@Schema(description = "会话权限")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SessionPermissions {
    @Schema(description = "本会话已允许的 TOOL 类型工具")
    @Builder.Default
    private List<String> allowedTools = new ArrayList<>();

    @Schema(description = "本会话允许读取的目录")
    @Builder.Default
    private List<String> readPaths = new ArrayList<>();

    @Schema(description = "本会话允许读写的目录")
    @Builder.Default
    private List<String> readWritePaths = new ArrayList<>();
}
