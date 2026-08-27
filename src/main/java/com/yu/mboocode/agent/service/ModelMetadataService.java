package com.yu.mboocode.agent.service;

import cn.hutool.core.util.StrUtil;
import cn.hutool.http.Header;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.model.ModelInfo;
import com.yu.mboocode.agent.model.ModelLimit;
import com.yu.mboocode.common.util.AppDataPaths;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
@Slf4j
public class ModelMetadataService {
    private static final String CATALOG_URL = "https://models.dev/api.json";
    private static final int CACHE_VERSION = 1;
    private static final int REQUEST_TIMEOUT = 10_000;
    private static final Path CACHE_PATH = AppDataPaths.root().resolve("cache/model-metadata.json");

    private volatile Map<String, ModelInfo> metadata;

    /** 启动阶段只读取本地缓存，不能因为磁盘缓存不可用阻塞 Spring 启动。 */
    public synchronized Map<String, ModelInfo> loadCachedMetadata() {
        if (metadata != null) return metadata;
        metadata = readCache();
        return metadata;
    }

    /** 设置测试等显式动作需要完整目录时，缓存为空才同步执行一次远程读取。 */
    public synchronized Map<String, ModelInfo> loadMetadata() {
        Map<String, ModelInfo> cached = loadCachedMetadata();
        return cached.isEmpty() ? refreshMetadata() : cached;
    }

    /** 后台刷新目录并原子更新磁盘缓存；调用方负责处理远程失败降级。 */
    public synchronized Map<String, ModelInfo> refreshMetadata() {
        JSONObject root;
        try (HttpResponse response = HttpRequest.get(CATALOG_URL).header(Header.ACCEPT, "application/json").timeout(REQUEST_TIMEOUT).execute()) {
            if (!response.isOk()) {
                log.error("models.dev 模型目录请求失败，地址: {}，状态码: {}", CATALOG_URL, response.getStatus());
                throw new IllegalStateException("models.dev 模型目录请求失败");
            }
            String body = response.body();
            if (StrUtil.isBlank(body)) throw new IllegalStateException("models.dev 模型目录响应为空");
            root = JSON.parseObject(body);
            if (root == null) throw new IllegalStateException("models.dev 模型目录根结构不是对象");
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            log.error("models.dev 模型目录加载失败，地址: {}", CATALOG_URL, e);
            throw new IllegalStateException("models.dev 模型目录加载失败", e);
        }

        LinkedHashMap<String, ModelInfo> cleaned = new LinkedHashMap<>();
        int totalCount = 0;
        int invalidCount = 0;
        int duplicateCount = 0;
        for (Object providerValue : root.values()) {
            if (!(providerValue instanceof JSONObject provider)) continue;
            Object modelsValue = provider.get("models");
            if (!(modelsValue instanceof JSONObject models)) continue;
            for (Object modelValue : models.values()) {
                totalCount++;
                if (!(modelValue instanceof JSONObject model)) {
                    invalidCount++;
                    continue;
                }
                ModelInfo modelInfo = cleanModel(model);
                if (modelInfo == null) {
                    invalidCount++;
                    continue;
                }
                if (cleaned.putIfAbsent(modelInfo.modelId(), modelInfo) != null) duplicateCount++;
            }
        }
        if (cleaned.isEmpty()) throw new IllegalStateException("models.dev 模型目录没有有效模型");
        metadata = Collections.unmodifiableMap(new LinkedHashMap<>(cleaned));
        writeCache(metadata);
        log.info("models.dev 模型目录清洗完成，总记录数: {}，无效记录数: {}，重复 ID 数: {}，有效模型数: {}", totalCount, invalidCount, duplicateCount, metadata.size());
        return metadata;
    }

    private Map<String, ModelInfo> readCache() {
        if (!Files.isRegularFile(CACHE_PATH)) return Map.of();
        try {
            JSONObject envelope = JSON.parseObject(Files.readString(CACHE_PATH, StandardCharsets.UTF_8));
            if (envelope == null || !Integer.valueOf(CACHE_VERSION).equals(envelope.getInteger("version"))) return Map.of();
            JSONObject models = envelope.getJSONObject("models");
            if (models == null || models.isEmpty()) return Map.of();
            LinkedHashMap<String, ModelInfo> result = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : models.entrySet()) {
                if (!(entry.getValue() instanceof JSONObject value)) continue;
                try {
                    ModelInfo modelInfo = JSON.parseObject(value.toJSONString(), ModelInfo.class);
                    if (isValidModelInfo(modelInfo) && entry.getKey().equals(modelInfo.modelId())) result.putIfAbsent(entry.getKey(), modelInfo);
                } catch (RuntimeException ignored) {
                    // 单条缓存损坏时跳过该条，避免丢弃其余可用目录。
                }
            }
            return result.isEmpty() ? Map.of() : Collections.unmodifiableMap(result);
        } catch (Exception e) {
            log.warn("本地模型目录缓存读取失败，将在后台重新刷新：{}", CACHE_PATH, e);
            return Map.of();
        }
    }

    private void writeCache(Map<String, ModelInfo> models) {
        Path cacheDirectory = CACHE_PATH.getParent();
        if (cacheDirectory == null) return;
        Path temporaryPath = cacheDirectory.resolve(CACHE_PATH.getFileName() + ".tmp-" + UUID.randomUUID());
        try {
            Files.createDirectories(cacheDirectory);
            LinkedHashMap<String, Object> envelope = new LinkedHashMap<>();
            envelope.put("version", CACHE_VERSION);
            envelope.put("updatedAt", java.time.Instant.now().toString());
            envelope.put("models", models);
            Files.writeString(temporaryPath, JSON.toJSONString(envelope), StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
            try {
                Files.move(temporaryPath, CACHE_PATH, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporaryPath, CACHE_PATH, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            log.warn("本地模型目录缓存写入失败：{}", CACHE_PATH, e);
        } finally {
            try {
                Files.deleteIfExists(temporaryPath);
            } catch (IOException ignored) {
                // 临时文件清理失败不影响本次内存刷新结果。
            }
        }
    }

    private boolean isValidModelInfo(ModelInfo modelInfo) {
        return modelInfo != null && StrUtil.isNotBlank(modelInfo.modelId()) && StrUtil.isNotBlank(modelInfo.name())
                && modelInfo.limit() != null && positive(modelInfo.limit().context()) && positive(modelInfo.limit().output())
                && (modelInfo.limit().input() == null || positive(modelInfo.limit().input()));
    }

    private boolean positive(Long value) {
        return value != null && value > 0;
    }

    private ModelInfo cleanModel(JSONObject model) {
        String modelId = cleanRequiredString(model.get("id"));
        String name = cleanRequiredString(model.get("name"));
        Object limitValue = model.get("limit");
        if (modelId == null || name == null || !(limitValue instanceof JSONObject limit)) return null;
        Long context = positiveLong(limit.get("context"));
        Long output = positiveLong(limit.get("output"));
        Long input = limit.containsKey("input") ? positiveLong(limit.get("input")) : null;
        if (context == null || output == null || limit.containsKey("input") && input == null) return null;

        return new ModelInfo(modelId, name, cleanOptionalString(model.get("family")), cleanOptionalString(model.get("status")),
                new ModelLimit(context, input, output), booleanValue(model.get("tool_call")), booleanValue(model.get("reasoning")),
                reasoningOptions(model.get("reasoning_options")), booleanValue(model.get("attachment")),
                modalities(model.get("modalities"), "input"), modalities(model.get("modalities"), "output"));
    }

    private String cleanRequiredString(Object value) {
        if (!(value instanceof String text)) return null;
        String cleaned = text.trim();
        return cleaned.isEmpty() ? null : cleaned;
    }

    private String cleanOptionalString(Object value) {
        return cleanRequiredString(value);
    }

    private Long positiveLong(Object value) {
        if (!(value instanceof Number number)) return null;
        try {
            BigDecimal decimal = new BigDecimal(number.toString()).stripTrailingZeros();
            if (decimal.scale() > 0 || decimal.signum() <= 0) return null;
            BigInteger integer = decimal.toBigIntegerExact();
            if (integer.compareTo(BigInteger.valueOf(Long.MAX_VALUE)) > 0) return null;
            return integer.longValueExact();
        } catch (NumberFormatException | ArithmeticException e) {
            return null;
        }
    }

    private boolean booleanValue(Object value) {
        return value instanceof Boolean bool && bool;
    }

    private List<Map<String, Object>> reasoningOptions(Object value) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (value instanceof JSONObject option) {
            result.add(new LinkedHashMap<>(option));
        } else if (value instanceof JSONArray options) {
            for (Object item : options) {
                if (item instanceof JSONObject option) result.add(new LinkedHashMap<>(option));
            }
        }
        return result;
    }

    private List<String> modalities(Object modalitiesValue, String field) {
        if (!(modalitiesValue instanceof JSONObject modalities) || !(modalities.get(field) instanceof JSONArray values)) return List.of();
        Set<String> result = new LinkedHashSet<>();
        for (Object value : values) {
            if (!(value instanceof String text)) continue;
            String cleaned = text.trim();
            if (!cleaned.isEmpty()) result.add(cleaned);
        }
        return List.copyOf(result);
    }
}
