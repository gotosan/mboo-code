package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "保存工作区信息")
public record WorkspaceResp(
        @Schema(description = "工作区 ID") String id,
        @Schema(description = "工作区名称，取路径末级文件夹名") String name,
        @Schema(description = "规范化后的真实绝对路径") String path,
        @Schema(description = "工作区目录当前是否可用") boolean available,
        @Schema(description = "工作区首次保存时间") String createdAt
) {
}
