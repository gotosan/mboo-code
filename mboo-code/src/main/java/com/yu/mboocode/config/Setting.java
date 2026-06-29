package com.yu.mboocode.config;

import lombok.Builder;
import lombok.Getter;

@Getter
@Builder
public class Setting {
    private String provider;

    private String apiKey;

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
