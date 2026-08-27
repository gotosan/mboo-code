package com.yu.mboocode.config;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONException;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.yu.mboocode.common.util.AppDataPaths;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/**
 * 统一管理 setting.json 的读取和原子写入。原始 JSON 在更新时保留未知字段，避免新版本覆盖旧版本尚未认识的配置。
 */
@Component
public class SettingFileStore {
    private static final String SETTING_FILE_NAME = "setting.json";

    public Path settingPath() {
        return AppDataPaths.root().resolve(SETTING_FILE_NAME);
    }

    public synchronized JSONObject readRawOrCreate() {
        Path path = settingPath();
        if (Files.notExists(path)) {
            JSONObject defaults = JSON.parseObject(JSON.toJSONString(Setting.defaultSetting()));
            writeAtomically(path, defaults);
            return defaults;
        }
        try {
            String json = Files.readString(path, StandardCharsets.UTF_8);
            JSONObject object = JSON.parseObject(json);
            return object == null ? new JSONObject() : object;
        } catch (JSONException e) {
            throw new IllegalStateException("配置文件格式错误: " + path, e);
        } catch (IOException e) {
            throw new IllegalStateException("读取配置文件失败: " + path, e);
        }
    }

    public Setting readEffective() {
        return toEffective(readRawOrCreate());
    }

    public Setting toEffective(JSONObject object) {
        try {
            Setting setting = JSON.parseObject(object.toJSONString(), Setting.class);
            return mergeDefaults(setting == null ? Setting.defaultSetting() : setting);
        } catch (JSONException e) {
            throw new IllegalStateException("配置文件格式错误: " + settingPath(), e);
        }
    }

    public synchronized void writeAtomically(JSONObject object) {
        writeAtomically(settingPath(), object);
    }

    private void writeAtomically(Path path, JSONObject object) {
        Path parent = path.getParent();
        Path temporary = null;
        try {
            Files.createDirectories(parent);
            temporary = Files.createTempFile(parent, SETTING_FILE_NAME + ".", ".tmp");
            Files.writeString(temporary, JSON.toJSONString(object, JSONWriter.Feature.PrettyFormat), StandardCharsets.UTF_8);
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
            temporary = null;
        } catch (IOException e) {
            throw new IllegalStateException("写入配置文件失败: " + path, e);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // 临时文件清理失败不覆盖原始写入错误。
                }
            }
        }
    }

    private Setting mergeDefaults(Setting setting) {
        Setting defaults = Setting.defaultSetting();
        return Setting.builder()
                .apiKey(setting.getApiKey() == null ? defaults.getApiKey() : setting.getApiKey())
                .baseUrl(setting.getBaseUrl() == null ? defaults.getBaseUrl() : setting.getBaseUrl())
                .webSearchExaApiKey(setting.getWebSearchExaApiKey() == null ? defaults.getWebSearchExaApiKey() : setting.getWebSearchExaApiKey())
                .webFetchPrivateNetworkEnabled(setting.getWebFetchPrivateNetworkEnabled() == null ? defaults.getWebFetchPrivateNetworkEnabled() : setting.getWebFetchPrivateNetworkEnabled())
                .ignoredFilePatterns(setting.getIgnoredFilePatterns() == null ? Setting.defaultIgnoredFilePatterns() : setting.getIgnoredFilePatterns())
                .ignoredFilePatternExceptions(setting.getIgnoredFilePatternExceptions() == null ? Setting.defaultIgnoredFilePatternExceptions() : setting.getIgnoredFilePatternExceptions())
                .build();
    }
}
