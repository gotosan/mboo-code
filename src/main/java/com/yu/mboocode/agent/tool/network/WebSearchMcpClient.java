package com.yu.mboocode.agent.tool.network;

import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.dto.NetworkErrorData;
import com.yu.mboocode.config.Setting;
import jakarta.annotation.Resource;
import org.apache.hc.core5.http.ContentType;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class WebSearchMcpClient {
    private static final int MAX_RESPONSE_BYTES = 256 * 1024;
    private static final URI ENDPOINT = URI.create("https://mcp.exa.ai/mcp");
    @Resource
    private Setting setting;
    @Resource
    private NetworkAccessPolicy accessPolicy;
    @Resource
    private NetworkHttpClient httpClient;
    @Resource
    private WebSearchResponseParser responseParser;

    public WebSearchResponseParser.ParsedSearch search(String query, int maxResults, long deadlineNanos, RunningNetworkCall call) {
        URI endpoint = endpoint();
        NetworkAccessPolicy.Inspection inspection = accessPolicy.inspectPublicOnly(endpoint, deadlineNanos);
        Map<String, Object> arguments = new LinkedHashMap<>();
        arguments.put("query", query);
        arguments.put("type", "auto");
        arguments.put("numResults", maxResults);
        arguments.put("livecrawl", "fallback");
        arguments.put("contextMaxCharacters", 40_000);
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("name", "web_search_exa");
        params.put("arguments", arguments);
        Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("jsonrpc", "2.0");
        requestBody.put("id", 1);
        requestBody.put("method", "tools/call");
        requestBody.put("params", params);
        Map<String, String> headers = Map.of(
                "Accept", "application/json, text/event-stream",
                "Accept-Language", "zh-CN,zh;q=0.9,en;q=0.7",
                "User-Agent", "mboo-code/0.0.1-SNAPSHOT"
        );
        NetworkHttpClient.Response response = httpClient.execute(inspection, "POST", JSON.toJSONBytes(requestBody), ContentType.APPLICATION_JSON,
                headers, MAX_RESPONSE_BYTES, deadlineNanos, call);
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw providerHttpError(response);
        return responseParser.parse(response.body());
    }

    private URI endpoint() {
        String apiKey = StrUtil.trim(setting.getWebSearchExaApiKey());
        if (StrUtil.isBlank(apiKey)) return ENDPOINT;
        return URI.create(ENDPOINT + "?exaApiKey=" + URLEncoder.encode(apiKey, StandardCharsets.UTF_8));
    }

    private NetworkToolException providerHttpError(NetworkHttpClient.Response response) {
        int status = response.statusCode();
        boolean retryable = status == 429 || status >= 500;
        Long retryAfter = parseRetryAfter(response.header("retry-after"));
        NetworkErrorData data = new NetworkErrorData(status, ENDPOINT.toString(), ENDPOINT.toString(), null, retryable, retryAfter);
        NetworkToolErrorCode code = status == 429 ? NetworkToolErrorCode.NETWORK_RATE_LIMITED : NetworkToolErrorCode.WEB_SEARCH_PROVIDER_ERROR;
        return new NetworkToolException(code, status == 429 ? "搜索供应商请求受到限流" : "搜索供应商请求失败，HTTP " + status, data);
    }

    private Long parseRetryAfter(String value) {
        if (value == null) return null;
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
