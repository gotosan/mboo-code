package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "应用设置摘要")
public record ModelSettingsResp(
        @Schema(description = "模型服务 Base URL") String baseUrl,
        @Schema(description = "模型 API Key 是否已配置") boolean apiKeyConfigured,
        @Schema(description = "模型 API Key 掩码") String apiKeyMasked,
        @Schema(description = "Exa API Key 是否已配置") boolean webSearchExaApiKeyConfigured,
        @Schema(description = "Exa API Key 掩码") String webSearchExaApiKeyMasked,
        @Schema(description = "是否启用网页抓取私有网络能力") boolean webFetchPrivateNetworkEnabled,
        @Schema(description = "全局忽略文件规则") List<String> ignoredFilePatterns,
        @Schema(description = "全局忽略文件例外规则") List<String> ignoredFilePatternExceptions,
        @Schema(description = "模型服务状态") String status,
        @Schema(description = "模型服务状态说明") String statusMessage,
        @Schema(description = "当前进程可用模型数量") int modelCount,
        @Schema(description = "是否需要重启后生效") boolean restartRequired,
        @Schema(description = "未管理字段数量") int unknownFieldCount
) {
}
