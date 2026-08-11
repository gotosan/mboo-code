package com.yu.mboocode.agent.tool.network;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.tool.dto.WebSearchResult;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Component
public class WebSearchResponseParser {
    private static final int CONTENT_BUDGET = 40_000;

    public ParsedSearch parse(byte[] body) {
        String responseText = new String(body, java.nio.charset.StandardCharsets.UTF_8);
        JSONObject response = parseJson(responseText);
        if (response == null) response = parseSse(responseText);
        if (response == null) {
            throw new NetworkToolException(NetworkToolErrorCode.WEB_SEARCH_INVALID_RESPONSE, "搜索供应商响应格式无效");
        }
        JSONObject error = response.getJSONObject("error");
        if (error != null) throw new NetworkToolException(NetworkToolErrorCode.WEB_SEARCH_PROVIDER_ERROR, "搜索供应商返回错误");
        if (response.getJSONObject("result") == null) throw new NetworkToolException(NetworkToolErrorCode.WEB_SEARCH_INVALID_RESPONSE, "搜索供应商响应缺少 result");
        JSONArray content = response.getJSONObject("result").getJSONArray("content");
        if (content == null) throw new NetworkToolException(NetworkToolErrorCode.WEB_SEARCH_INVALID_RESPONSE, "搜索供应商响应缺少内容");
        String providerText = null;
        for (Object item : content) {
            JSONObject block;
            try {
                block = item instanceof JSONObject object ? object : JSON.parseObject(JSON.toJSONString(item));
            } catch (RuntimeException e) {
                continue;
            }
            String text = block == null ? null : block.getString("text");
            if ("text".equals(block == null ? null : block.getString("type")) && text != null && !text.isBlank()) {
                providerText = text;
                break;
            }
        }
        if (providerText == null) throw new NetworkToolException(NetworkToolErrorCode.WEB_SEARCH_INVALID_RESPONSE, "搜索供应商没有返回可识别文本");
        return standardize(providerText);
    }

    private ParsedSearch standardize(String text) {
        List<WebSearchResult> parsed = parseBlocks(text);
        if (parsed.isEmpty()) {
            if (looksLikeNoResults(text)) return new ParsedSearch(true, List.of(), null, false);
            boolean truncated = text.length() > CONTENT_BUDGET;
            return new ParsedSearch(false, List.of(), truncate(text, CONTENT_BUDGET), truncated);
        }
        List<WebSearchResult> results = new ArrayList<>();
        int used = 0;
        boolean truncated = false;
        for (WebSearchResult result : parsed) {
            int fixed = length(result.title()) + length(result.url()) + length(result.publishedDate()) + length(result.author());
            if (used + fixed > CONTENT_BUDGET) {
                truncated = true;
                break;
            }
            int availableSnippet = Math.max(0, CONTENT_BUDGET - used - fixed);
            String snippet = result.snippet();
            if (snippet != null && snippet.length() > availableSnippet) {
                snippet = truncate(snippet, availableSnippet);
                truncated = true;
            }
            results.add(new WebSearchResult(result.title(), result.url(), result.publishedDate(), result.author(), snippet));
            used += fixed + length(snippet);
            if (used >= CONTENT_BUDGET) {
                truncated |= results.size() < parsed.size();
                break;
            }
        }
        return new ParsedSearch(true, results, null, truncated);
    }

    private List<WebSearchResult> parseBlocks(String text) {
        List<WebSearchResult> results = new ArrayList<>();
        Set<String> seenUrls = new LinkedHashSet<>();
        SearchBlock block = null;
        boolean highlights = false;
        for (String line : text.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
            if (line.startsWith("Title:")) {
                addBlock(results, seenUrls, block);
                block = new SearchBlock();
                block.title = value(line);
                highlights = false;
            } else if (block != null && line.startsWith("URL:")) {
                block.url = value(line);
                highlights = false;
            } else if (block != null && (line.startsWith("Published:") || line.startsWith("Published Date:"))) {
                block.publishedDate = value(line);
                highlights = false;
            } else if (block != null && line.startsWith("Author:")) {
                block.author = value(line);
                highlights = false;
            } else if (block != null && line.startsWith("Highlights:")) {
                highlights = true;
                String value = value(line);
                if (!value.isBlank()) block.snippet.append(value);
            } else if (block != null && highlights) {
                if (!block.snippet.isEmpty()) block.snippet.append('\n');
                block.snippet.append(line);
            }
        }
        addBlock(results, seenUrls, block);
        return results;
    }

    private void addBlock(List<WebSearchResult> results, Set<String> seenUrls, SearchBlock block) {
        if (block == null || block.url == null) return;
        try {
            URI uri = URI.create(block.url.trim());
            if (!uri.isAbsolute() || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) return;
            String url = uri.toASCIIString();
            if (!seenUrls.add(url)) return;
            results.add(new WebSearchResult(blankToNull(block.title), url, blankToNull(block.publishedDate), blankToNull(block.author), blankToNull(block.snippet.toString().trim())));
        } catch (IllegalArgumentException ignored) {
            // 单条 URL 损坏时只忽略当前结果，保留其他来源。
        }
    }

    private JSONObject parseJson(String text) {
        try {
            return JSON.parseObject(text);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private JSONObject parseSse(String text) {
        for (String line : text.replace("\r\n", "\n").split("\n")) {
            if (!line.startsWith("data:")) continue;
            String data = line.substring(5).trim();
            if (data.isEmpty() || "[DONE]".equals(data)) continue;
            JSONObject value = parseJson(data);
            if (value != null && value.getJSONObject("result") != null) return value;
        }
        return null;
    }

    private boolean looksLikeNoResults(String text) {
        String value = text.trim().toLowerCase();
        return value.isEmpty() || value.equals("no results") || value.contains("no search results") || value.contains("no results found")
                || value.contains("no relevant results") || value.contains("没有搜索结果");
    }

    private String value(String line) {
        int colon = line.indexOf(':');
        return colon < 0 ? "" : line.substring(colon + 1).trim();
    }

    private int length(String value) {
        return value == null ? 0 : value.length();
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) return value;
        if (maxLength <= 0) return "";
        return value.substring(0, maxLength);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    public record ParsedSearch(boolean structured, List<WebSearchResult> results, String providerContent, boolean truncated) {
    }

    private static final class SearchBlock {
        private String title;
        private String url;
        private String publishedDate;
        private String author;
        private final StringBuilder snippet = new StringBuilder();
    }
}
