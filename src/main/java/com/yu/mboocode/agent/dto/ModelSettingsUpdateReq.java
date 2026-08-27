package com.yu.mboocode.agent.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "模型与应用设置更新请求")
public record ModelSettingsUpdateReq(
        @Schema(description = "模型服务 Base URL；空值表示未配置") String baseUrl,
        @Schema(description = "模型服务 API Key；省略表示保持原值") String apiKey,
        @Schema(description = "是否清除模型服务 API Key") Boolean clearApiKey,
        @Schema(description = "Exa API Key；省略表示保持原值") String webSearchExaApiKey,
        @Schema(description = "是否清除 Exa API Key") Boolean clearWebSearchExaApiKey,
        @Schema(description = "是否启用网页抓取私有网络能力") Boolean webFetchPrivateNetworkEnabled,
        @Schema(description = "全局忽略文件规则") List<String> ignoredFilePatterns,
        @Schema(description = "全局忽略文件例外规则") List<String> ignoredFilePatternExceptions
) {
}
