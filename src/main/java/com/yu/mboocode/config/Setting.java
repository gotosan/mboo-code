package com.yu.mboocode.config;

import com.alibaba.fastjson2.annotation.JSONField;
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
    @JSONField(name = "provider")
    private String provider;

    @Schema(description = "模型供应商 API Key")
    @JSONField(name = "api_key")
    private String apiKey;

    @Schema(description = "模型供应商 Base URL")
    @JSONField(name = "base_url")
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
