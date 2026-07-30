package com.yu.mboocode.agent.model.payload;

import com.yu.mboocode.llm.tool.permission.ToolPermissionType;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 工具等待用户授权事件主体。
 */
@Schema(description = "工具等待用户授权事件主体")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ToolApprovalRequiredPayload implements SessionEventPayload {
    @Schema(description = "助手消息 ID")
    private String messageId;

    @Schema(description = "授权请求 ID")
    private String approvalId;

    @Schema(description = "工具调用 ID")
    private String toolCallId;

    @Schema(description = "工具名称")
    private String toolName;

    @Schema(description = "工具调用参数 JSON 字符串")
    private String arguments;

    @Schema(description = "授权提示标题")
    private String title;

    @Schema(description = "授权提示说明")
    private String description;

    @Schema(description = "本次申请的权限类型；历史事件缺失时按 TOOL 兼容")
    private ToolPermissionType permissionType;

    @Schema(description = "申请授权的规范化绝对目录，仅 READ/WRITE 使用")
    private String grantPath;

    @Schema(description = "当前授权阶段，从 1 开始")
    private Integer approvalIndex;

    @Schema(description = "授权阶段总数")
    private Integer approvalCount;
}
