package com.yu.mboocode.agent.dto;

import com.yu.mboocode.agent.enums.ToolApprovalDecision;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@Schema(description = "工具授权请求体")
public record ToolApprovalReq(
        @Schema(description = "授权决定：ALLOW_ONCE 允许本次、ALLOW_SESSION 本会话允许、DENY 拒绝")
        @NotNull(message = "授权决定不能为空")
        ToolApprovalDecision decision
) {}
