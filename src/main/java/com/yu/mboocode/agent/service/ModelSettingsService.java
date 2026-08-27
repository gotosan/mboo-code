package com.yu.mboocode.agent.service;

import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.dto.ModelSettingsResp;
import com.yu.mboocode.agent.dto.ModelSettingsUpdateReq;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.config.Setting;
import com.yu.mboocode.config.SettingFileStore;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.FileSystems;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * 提供 setting.json 的结构化管理。配置保存只改变磁盘目标，运行中的 Spring Bean 仍使用启动时快照，统一由重启使其生效。
 */
@Service
public class ModelSettingsService {
    private static final String RESTART_REQUIRED_STATUS = "RESTART_REQUIRED";
    private static final Set<String> KNOWN_FIELDS = Set.of("api_key", "base_url", "web_search_exa_api_key", "web_fetch_private_network_enabled", "ignored_file_patterns", "ignored_file_pattern_exceptions");

    @Resource
    private Setting setting;
    @Resource
    private SettingFileStore settingFileStore;
    @Resource
    private ModelOptionService modelOptionService;

    public ModelSettingsResp get() {
        JSONObject raw = settingFileStore.readRawOrCreate();
        Setting target = settingFileStore.toEffective(raw);
        return toResponse(target, modelOptionService.getModelNames().size(), null, unknownFieldCount(raw));
    }

    public ModelSettingsResp test(ModelSettingsUpdateReq request) {
        JSONObject raw = settingFileStore.readRawOrCreate();
        Setting target = mergeTarget(settingFileStore.toEffective(raw), request);
        validateBaseUrl(target.getBaseUrl());
        ModelOptionService.ModelProbeResult probe;
        try {
            probe = modelOptionService.probe(target.getApiKey(), target.getBaseUrl());
        } catch (RuntimeException e) {
            throw new ServiceException(publicProbeMessage(e));
        }
        return toResponse(target, probe.modelCount(), ModelOptionService.ModelServiceStatus.CONNECTED, unknownFieldCount(raw));
    }

    public synchronized ModelSettingsResp update(ModelSettingsUpdateReq request) {
        if (request == null) throw new ServiceException("模型设置请求不能为空");
        JSONObject raw = settingFileStore.readRawOrCreate();
        Setting currentTarget = settingFileStore.toEffective(raw);
        Setting target = mergeTarget(currentTarget, request);
        validateBaseUrl(target.getBaseUrl());

        boolean modelConfigChanged = !sameModelConfig(currentTarget, target);
        if (modelConfigChanged && StrUtil.isNotBlank(target.getApiKey()) && StrUtil.isNotBlank(target.getBaseUrl())) {
            try {
                modelOptionService.probe(target.getApiKey(), target.getBaseUrl());
            } catch (RuntimeException e) {
                throw new ServiceException(publicProbeMessage(e));
            }
        }

        raw.put("api_key", target.getApiKey());
        raw.put("base_url", target.getBaseUrl());
        raw.put("web_search_exa_api_key", target.getWebSearchExaApiKey());
        raw.put("web_fetch_private_network_enabled", target.getWebFetchPrivateNetworkEnabled());
        raw.put("ignored_file_patterns", target.getIgnoredFilePatterns());
        raw.put("ignored_file_pattern_exceptions", target.getIgnoredFilePatternExceptions());
        settingFileStore.writeAtomically(raw);
        return toResponse(target, modelOptionService.getModelNames().size(), null, unknownFieldCount(raw));
    }

    private Setting mergeTarget(Setting current, ModelSettingsUpdateReq request) {
        if (request == null) throw new ServiceException("模型设置请求不能为空");
        String baseUrl = request.baseUrl() == null ? current.getBaseUrl() : cleanBaseUrl(request.baseUrl());
        String apiKey = resolveSecret(request.apiKey(), request.clearApiKey(), current.getApiKey());
        String exaApiKey = resolveSecret(request.webSearchExaApiKey(), request.clearWebSearchExaApiKey(), current.getWebSearchExaApiKey());
        Boolean privateNetwork = request.webFetchPrivateNetworkEnabled() == null ? current.getWebFetchPrivateNetworkEnabled() : request.webFetchPrivateNetworkEnabled();
        List<String> ignored = request.ignoredFilePatterns() == null ? normalizeRules(current.getIgnoredFilePatterns()) : normalizeRules(request.ignoredFilePatterns());
        List<String> exceptions = request.ignoredFilePatternExceptions() == null ? normalizeRules(current.getIgnoredFilePatternExceptions()) : normalizeRules(request.ignoredFilePatternExceptions());
        validateGlobRules(ignored, "ignored_file_patterns");
        validateGlobRules(exceptions, "ignored_file_pattern_exceptions");
        return Setting.builder()
                .apiKey(apiKey)
                .baseUrl(baseUrl)
                .webSearchExaApiKey(exaApiKey)
                .webFetchPrivateNetworkEnabled(Boolean.TRUE.equals(privateNetwork))
                .ignoredFilePatterns(ignored)
                .ignoredFilePatternExceptions(exceptions)
                .build();
    }

    private String resolveSecret(String submitted, Boolean clear, String current) {
        if (Boolean.TRUE.equals(clear)) return "";
        return StrUtil.isBlank(submitted) ? StrUtil.trim(current) : submitted.trim();
    }

    private String cleanBaseUrl(String value) {
        return StrUtil.removeSuffix(StrUtil.trim(value), "/");
    }

    private void validateBaseUrl(String value) {
        String cleaned = cleanBaseUrl(value);
        if (StrUtil.isBlank(cleaned)) return;
        try {
            URI uri = new URI(cleaned);
            if (!uri.isAbsolute() || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || StrUtil.isBlank(uri.getHost()) || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                throw new ServiceException("模型服务 Base URL 必须是合法的 http/https 地址，且不能包含凭据、查询参数或片段");
            }
        } catch (URISyntaxException e) {
            throw new ServiceException("模型服务 Base URL 格式无效");
        }
    }

    private void validateGlobRules(List<String> rules, String settingName) {
        for (String rule : rules) {
            try {
                FileSystems.getDefault().getPathMatcher("glob:" + rule);
            } catch (RuntimeException e) {
                throw new ServiceException("配置项 " + settingName + " 包含非法 glob：" + rule);
            }
        }
    }

    private List<String> normalizeRules(List<String> rules) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        if (rules != null) {
            for (String rule : rules) {
                String value = StrUtil.trim(rule);
                if (StrUtil.isNotBlank(value)) values.add(value.replace('\\', '/'));
            }
        }
        return List.copyOf(values);
    }

    private ModelSettingsResp toResponse(Setting target, int modelCount, ModelOptionService.ModelServiceStatus testStatus, int unknownFieldCount) {
        boolean restartRequired = !sameKnownSettings(setting, target);
        String status;
        String statusMessage;
        if (restartRequired) {
            status = RESTART_REQUIRED_STATUS;
            statusMessage = "配置更新重启后生效";
        } else if (testStatus != null) {
            status = testStatus.name();
            statusMessage = testStatus.getLabel();
        } else {
            status = modelOptionService.getStatus().name();
            statusMessage = modelOptionService.getStatusMessage();
        }
        return new ModelSettingsResp(cleanBaseUrl(target.getBaseUrl()), StrUtil.isNotBlank(target.getApiKey()), maskSecret(target.getApiKey()),
                StrUtil.isNotBlank(target.getWebSearchExaApiKey()), maskSecret(target.getWebSearchExaApiKey()), Boolean.TRUE.equals(target.getWebFetchPrivateNetworkEnabled()),
                normalizeRules(target.getIgnoredFilePatterns()), normalizeRules(target.getIgnoredFilePatternExceptions()), status, statusMessage, modelCount, restartRequired, unknownFieldCount);
    }

    private int unknownFieldCount(JSONObject raw) {
        return (int) raw.keySet().stream().filter(key -> !KNOWN_FIELDS.contains(key)).count();
    }

    private boolean sameModelConfig(Setting left, Setting right) {
        return Objects.equals(cleanBaseUrl(left.getBaseUrl()), cleanBaseUrl(right.getBaseUrl())) && Objects.equals(StrUtil.trim(left.getApiKey()), StrUtil.trim(right.getApiKey()));
    }

    private boolean sameKnownSettings(Setting left, Setting right) {
        return sameModelConfig(left, right)
                && Objects.equals(StrUtil.trim(left.getWebSearchExaApiKey()), StrUtil.trim(right.getWebSearchExaApiKey()))
                && Objects.equals(Boolean.TRUE.equals(left.getWebFetchPrivateNetworkEnabled()), Boolean.TRUE.equals(right.getWebFetchPrivateNetworkEnabled()))
                && Objects.equals(normalizeRules(left.getIgnoredFilePatterns()), normalizeRules(right.getIgnoredFilePatterns()))
                && Objects.equals(normalizeRules(left.getIgnoredFilePatternExceptions()), normalizeRules(right.getIgnoredFilePatternExceptions()));
    }

    private String publicProbeMessage(Throwable error) {
        String message = error.getMessage();
        return StrUtil.isBlank(message) ? "模型服务连接失败" : message;
    }

    private String maskSecret(String value) {
        String secret = StrUtil.trim(value);
        if (StrUtil.isBlank(secret)) return null;
        if (secret.length() <= 6) return "••••";
        return secret.substring(0, Math.min(4, secret.length() - 2)) + "••••" + secret.substring(secret.length() - 2);
    }
}
