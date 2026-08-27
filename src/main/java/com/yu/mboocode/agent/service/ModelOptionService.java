package com.yu.mboocode.agent.service;

import cn.hutool.core.util.StrUtil;
import cn.hutool.http.Header;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.model.ModelInfo;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.config.Setting;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

/**
 * 应用启动时加载一次模型候选；模型服务未配置或不可达时保留空缓存，让设置页面仍可进入修正配置。
 */
@Service
@Slf4j
public class ModelOptionService {
    private static final int REQUEST_TIMEOUT = 10_000;

    @Resource
    private Setting setting;
    @Resource
    private ModelMetadataService modelMetadataService;

    @Getter
    private volatile List<String> modelNames = List.of();
    @Getter
    private volatile Map<String, ModelInfo> modelInfoMap = Map.of();
    @Getter
    private volatile ModelServiceStatus status = ModelServiceStatus.NOT_CONFIGURED;
    @Getter
    private volatile String statusMessage = ModelServiceStatus.NOT_CONFIGURED.getLabel();
    private final ExecutorService refreshExecutor = Executors.newVirtualThreadPerTaskExecutor();

    @PostConstruct
    public void initialize() {
        ModelServiceConfig config = cleanConfig(setting.getApiKey(), setting.getBaseUrl());
        try {
            if (StrUtil.isBlank(config.apiKey()) && StrUtil.isBlank(config.baseUrl())) {
                clearModels(ModelServiceStatus.NOT_CONFIGURED, ModelServiceStatus.NOT_CONFIGURED.getLabel());
                log.warn("模型服务尚未配置，跳过启动时模型列表加载");
                return;
            }
            if (StrUtil.isBlank(config.apiKey()) || StrUtil.isBlank(config.baseUrl())) {
                clearModels(ModelServiceStatus.CONNECTION_FAILED, "模型服务配置不完整，请同时填写 api_key 和 base_url");
                log.warn("模型服务配置不完整，跳过启动时模型列表加载");
                return;
            }
            Map<String, ModelInfo> cachedMetadata = modelMetadataService.loadCachedMetadata();
            setLoading(cachedMetadata);
            refreshExecutor.submit(() -> refreshModels(config, cachedMetadata));
        } catch (Exception e) {
            clearModels(ModelServiceStatus.CONNECTION_FAILED, "模型服务初始化失败");
            log.warn("模型服务初始化失败", e);
        }
    }

    @PreDestroy
    public void shutdown() {
        refreshExecutor.shutdownNow();
    }

    private void refreshModels(ModelServiceConfig config, Map<String, ModelInfo> cachedMetadata) {
        Map<String, ModelInfo> metadata = cachedMetadata;
        try {
            metadata = modelMetadataService.refreshMetadata();
        } catch (Exception e) {
            if (metadata.isEmpty()) {
                clearModels(ModelServiceStatus.CONNECTION_FAILED, "models.dev 模型目录加载失败");
                log.warn("models.dev 模型目录后台刷新失败，且没有可用缓存", e);
                return;
            }
            log.warn("models.dev 模型目录后台刷新失败，继续使用本地缓存", e);
        }
        try {
            publish(loadModels(config, metadata));
        } catch (ModelServiceException e) {
            clearModels(ModelServiceStatus.CONNECTION_FAILED, e.getMessage());
            log.warn("模型服务后台初始化失败，原因: {}", e.getMessage());
        } catch (Exception e) {
            clearModels(ModelServiceStatus.CONNECTION_FAILED, "模型服务连接失败");
            log.warn("模型服务后台初始化失败", e);
        }
    }

    /**
     * 使用候选配置访问供应商并完成 models.dev 匹配，但不改变当前进程的模型缓存或配置状态。
     */
    public ModelProbeResult probe(String apiKey, String baseUrl) {
        ModelServiceConfig config = cleanConfig(apiKey, baseUrl);
        if (StrUtil.isBlank(config.apiKey()) || StrUtil.isBlank(config.baseUrl())) {
            throw new ModelServiceException("模型服务配置不完整，请同时填写 api_key 和 base_url");
        }
        ModelLoadResult result = loadModels(config, modelMetadataService.refreshMetadata());
        return new ModelProbeResult(result.modelNames().size());
    }

    public ModelInfo requireModelInfo(String modelId) {
        String cleanedModelId = StrUtil.trim(modelId);
        ModelInfo modelInfo = StrUtil.isBlank(cleanedModelId) ? null : modelInfoMap.get(cleanedModelId);
        if (modelInfo == null && status == ModelServiceStatus.NOT_CONFIGURED) throw new ServiceException("模型服务未配置，请先在模型服务设置中填写 api_key 和 base_url");
        if (modelInfo == null && status == ModelServiceStatus.LOADING) throw new ServiceException(statusMessage);
        if (modelInfo == null && status == ModelServiceStatus.CONNECTION_FAILED && modelInfoMap.isEmpty()) throw new ServiceException(statusMessage);
        if (modelInfo == null) throw new ServiceException("模型不存在或未提供能力信息");
        return modelInfo;
    }

    public String validateReasoningEffort(ModelInfo modelInfo, String reasoningEffort) {
        String cleanedEffort = StrUtil.trim(reasoningEffort);
        if (StrUtil.isBlank(cleanedEffort)) return null;
        Set<String> values = new LinkedHashSet<>();
        for (Map<String, Object> option : modelInfo.reasoningOptions()) {
            if (!"effort".equals(option.get("type")) || !(option.get("values") instanceof List<?> optionValues)) continue;
            for (Object value : optionValues) {
                if (!(value instanceof String text)) continue;
                String cleaned = text.trim();
                if (!cleaned.isEmpty()) values.add(cleaned);
            }
        }
        if (!values.contains(cleanedEffort)) throw new ServiceException("当前模型不支持所选思考深度");
        return cleanedEffort;
    }

    private ModelLoadResult loadModels(ModelServiceConfig config, Map<String, ModelInfo> metadata) {
        String url = config.baseUrl() + "/models";
        try (HttpResponse response = HttpRequest.get(url)
                .header(Header.AUTHORIZATION, "Bearer " + config.apiKey())
                .header(Header.ACCEPT, "application/json")
                .timeout(REQUEST_TIMEOUT)
                .execute()) {
            if (!response.isOk()) throw new ModelServiceException("模型服务连接失败（供应商 HTTP " + response.getStatus() + "）");
            String responseBody = response.body();
            if (StrUtil.isBlank(responseBody)) throw new ModelServiceException("供应商模型列表响应为空");
            JSONObject body = JSON.parseObject(responseBody);
            JSONArray data = body == null ? null : body.getJSONArray("data");
            if (data == null) throw new ModelServiceException("供应商模型列表响应缺少 data 数组");

            Set<String> names = new LinkedHashSet<>();
            for (Object item : data) {
                if (!(item instanceof JSONObject model)) continue;
                Object idValue = model.get("id");
                String id = idValue instanceof String text ? text.trim() : null;
                if (StrUtil.isNotBlank(id)) names.add(id);
            }
            if (names.isEmpty()) throw new ModelServiceException("供应商模型列表没有有效模型 ID");

            Map<String, List<ModelInfo>> metadataByNormalizedName = metadata.values().stream()
                    .collect(Collectors.groupingBy(modelInfo -> normalizeModelName(modelInfo.name()), LinkedHashMap::new, Collectors.toList()));
            LinkedHashMap<String, ModelInfo> matched = new LinkedHashMap<>();
            for (String name : names) {
                ModelInfo modelInfo = metadata.get(name);
                if (modelInfo == null) {
                    String normalizedName = normalizeModelName(name);
                    List<ModelInfo> candidates = StrUtil.isBlank(normalizedName) ? List.of() : metadataByNormalizedName.getOrDefault(normalizedName, List.of());
                    if (candidates.size() == 1) modelInfo = candidates.get(0);
                }
                if (modelInfo != null) matched.put(name, bindProviderModelId(name, modelInfo));
            }
            if (matched.isEmpty()) throw new ModelServiceException("当前模型跟 models.dev 模型数据不匹配");
            return new ModelLoadResult(List.copyOf(matched.keySet()), Collections.unmodifiableMap(new LinkedHashMap<>(matched)));
        } catch (ModelServiceException e) {
            throw e;
        } catch (Exception e) {
            throw new ModelServiceException("模型服务连接失败", e);
        }
    }

    private void publish(ModelLoadResult result) {
        modelNames = result.modelNames();
        modelInfoMap = result.modelInfoMap();
        status = ModelServiceStatus.CONNECTED;
        statusMessage = ModelServiceStatus.CONNECTED.getLabel();
        log.info("模型列表加载完成，最终匹配数: {}", modelNames.size());
    }

    private void clearModels(ModelServiceStatus nextStatus, String message) {
        modelNames = List.of();
        modelInfoMap = Map.of();
        status = nextStatus;
        statusMessage = StrUtil.isBlank(message) ? nextStatus.getLabel() : message;
    }

    private void setLoading(Map<String, ModelInfo> cachedMetadata) {
        modelNames = List.of();
        modelInfoMap = Map.of();
        status = ModelServiceStatus.LOADING;
        statusMessage = cachedMetadata.isEmpty() ? "正在加载模型目录" : "正在刷新模型目录";
    }

    private ModelServiceConfig cleanConfig(String apiKey, String baseUrl) {
        return new ModelServiceConfig(StrUtil.trim(apiKey), StrUtil.removeSuffix(StrUtil.trim(baseUrl), "/"));
    }

    private String normalizeModelName(String value) {
        if (StrUtil.isBlank(value)) return "";
        return value.trim().toLowerCase(Locale.ROOT).codePoints()
                .filter(Character::isLetterOrDigit)
                .collect(StringBuilder::new, StringBuilder::appendCodePoint, StringBuilder::append)
                .toString();
    }

    private ModelInfo bindProviderModelId(String providerModelId, ModelInfo modelInfo) {
        if (providerModelId.equals(modelInfo.modelId())) return modelInfo;
        return new ModelInfo(providerModelId, modelInfo.name(), modelInfo.family(), modelInfo.status(), modelInfo.limit(),
                modelInfo.toolCall(), modelInfo.reasoning(), modelInfo.reasoningOptions(), modelInfo.attachment(),
                modelInfo.inputModalities(), modelInfo.outputModalities());
    }

    public record ModelProbeResult(int modelCount) {
    }

    public record ModelServiceConfig(String apiKey, String baseUrl) {
    }

    private record ModelLoadResult(List<String> modelNames, Map<String, ModelInfo> modelInfoMap) {
    }

    public enum ModelServiceStatus {
        NOT_CONFIGURED("未配置"),
        CONNECTION_FAILED("连接失败"),
        LOADING("加载中"),
        CONNECTED("已连接");

        private final String label;

        ModelServiceStatus(String label) {
            this.label = label;
        }

        public String getLabel() {
            return label;
        }
    }

    public static class ModelServiceException extends RuntimeException {
        public ModelServiceException(String message) {
            super(message);
        }

        public ModelServiceException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
