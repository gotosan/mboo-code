package com.yu.mboocode.config;

import com.alibaba.fastjson2.annotation.JSONField;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Builder;
import lombok.Getter;

import java.util.List;

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

    @Schema(description = "全局忽略文件规则")
    @JSONField(name = "ignored_file_patterns")
    private List<String> ignoredFilePatterns;

    @Schema(description = "全局忽略文件例外规则")
    @JSONField(name = "ignored_file_pattern_exceptions")
    private List<String> ignoredFilePatternExceptions;

    private static final List<String> DEFAULT_IGNORED_FILE_PATTERNS = List.of(
            ".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
            "credentials.json", "credentials.yml", "credentials.yaml", "secrets.json", "secrets.yml", "secrets.yaml"
    );
    private static final List<String> DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS = List.of(".env.example", ".env.template", ".env.sample");

    private static final Setting DEFAULT_SETTING = Setting.builder()
            .provider("openai")
            .apiKey("")
            .baseUrl("")
            .ignoredFilePatterns(DEFAULT_IGNORED_FILE_PATTERNS)
            .ignoredFilePatternExceptions(DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS)
            .build();

    public static Setting defaultSetting() {
        return DEFAULT_SETTING;
    }

    public static List<String> defaultIgnoredFilePatterns() {
        return DEFAULT_IGNORED_FILE_PATTERNS;
    }

    public static List<String> defaultIgnoredFilePatternExceptions() {
        return DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS;
    }
}
