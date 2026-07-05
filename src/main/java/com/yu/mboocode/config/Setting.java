package com.yu.mboocode.config;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Getter;

/**
 * 模型供应商配置。
 */
@Schema(description = "模型供应商配置")
@Getter
@Builder
public class Setting {
    @Schema(description = "模型供应商，例如 openai")
    private String provider;

    @Schema(description = "模型供应商 API Key")
    private String apiKey;

    @Schema(description = "模型供应商 Base URL")
    private String baseUrl;

    private static final Setting DEFAULT_SETTING = Setting.builder()
            .provider("openai")
            .apiKey("")
            .baseUrl("")
            .build();

    public static Setting defaultSetting() {
        return DEFAULT_SETTING;
    }
}
