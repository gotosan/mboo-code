package com.yu.mboocode.agent.service;

import cn.hutool.core.util.StrUtil;
import cn.hutool.http.Header;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.config.Setting;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 应用启动时加载一次模型候选，避免每个前端请求都访问模型供应商。
 */
@Service
@Slf4j
public class ModelOptionService {
    private static final int REQUEST_TIMEOUT = 10_000;
    private static final String NOT_CONFIGURED_MESSAGE = "模型服务未配置，请在 setting.json 中填写 api_key 和 base_url";
    private static final String LOAD_FAILED_MESSAGE = "模型列表加载失败，请检查模型服务配置并重启应用";

    @Resource
    private Setting setting;

    @Getter
    private volatile List<String> modelNames = List.of();
    @Getter
    private volatile String loadErrorMessage;

    @PostConstruct
    public void initialize() {
        String apiKey = StrUtil.trim(setting.getApiKey());
        String baseUrl = StrUtil.removeSuffix(StrUtil.trim(setting.getBaseUrl()), "/");
        if (StrUtil.isBlank(apiKey) || StrUtil.isBlank(baseUrl)) {
            loadErrorMessage = NOT_CONFIGURED_MESSAGE;
            log.warn(loadErrorMessage);
            return;
        }

        String url = baseUrl + "/models";
        try (HttpResponse response = HttpRequest.get(url)
                .header(Header.AUTHORIZATION, "Bearer " + apiKey)
                .header(Header.ACCEPT, "application/json")
                .timeout(REQUEST_TIMEOUT)
                .execute()) {
            if (!response.isOk()) {
                loadErrorMessage = LOAD_FAILED_MESSAGE;
                log.warn("模型列表加载失败，供应商返回状态码: {}", response.getStatus());
                return;
            }

            JSONObject body = JSON.parseObject(response.body());
            JSONArray data = body == null ? null : body.getJSONArray("data");
            if (data == null) {
                loadErrorMessage = LOAD_FAILED_MESSAGE;
                log.warn("模型列表加载失败，供应商响应缺少 data 数组");
                return;
            }

            Set<String> names = new LinkedHashSet<>();
            for (Object item : data) {
                if (!(item instanceof JSONObject model)) continue;
                String id = StrUtil.trim(model.getString("id"));
                if (StrUtil.isNotBlank(id)) names.add(id);
            }
            modelNames = List.copyOf(names);
            loadErrorMessage = null;
            log.info("模型列表加载完成，模型数量: {}", modelNames.size());
        } catch (Exception e) {
            modelNames = List.of();
            loadErrorMessage = LOAD_FAILED_MESSAGE;
            log.warn("模型列表加载失败，应用将继续启动并允许前端手动输入模型名称", e);
        }
    }

    public boolean isAvailable() {
        return loadErrorMessage == null;
    }
}
