package com.yu.mboocode.agent.tool.network;

import com.yu.mboocode.agent.tool.ToolInvocationContext;
import com.yu.mboocode.agent.tool.dto.ToolResult;
import com.yu.mboocode.agent.tool.dto.WebSearchData;
import com.yu.mboocode.agent.tool.permission.ToolPermission;
import com.yu.mboocode.agent.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import dev.langchain4j.agent.tool.ToolMemoryId;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;

@Component
public class WebSearchTool {
    @Resource
    private NetworkRequestValidator requestValidator;
    @Resource
    private NetworkConcurrencyLimiter concurrencyLimiter;
    @Resource
    private RunningNetworkCallRegistry runningCallRegistry;
    @Resource
    private WebSearchMcpClient mcpClient;

    @Tool("通过第三方 Exa 搜索公开互联网，用于发现当前信息来源。只发送完成任务所需的最小查询，不要包含密码、Token、私钥或大段私有源码；关键事实应继续使用 web_fetch 核实，近期信息应在查询中包含年份或时间范围。")
    @ToolPermission(value = ToolPermissionType.TOOL, title = "允许网络搜索", description = "搜索词会发送给第三方 Exa 服务。")
    public ToolResult<WebSearchData> web_search(
            @P(name = "query", value = "发送给 Exa 的搜索词，去除首尾空白后 1 至 1000 字符") String query,
            @P(name = "maxResults", value = "最大结果数量，默认 8，范围 1 至 20", defaultValue = "8") Integer maxResults,
            @ToolMemoryId String sessionId) {
        var arguments = new com.alibaba.fastjson2.JSONObject();
        arguments.put("query", query);
        arguments.put("maxResults", maxResults);
        NetworkRequestValidator.WebSearchArguments validated = requestValidator.validateSearch(arguments);
        long startedAt = System.nanoTime();
        long deadline = startedAt + Duration.ofSeconds(25).toNanos();
        ToolInvocationContext.Value context = ToolInvocationContext.current();
        String toolCallId = context == null || context.toolCallId() == null ? "direct-" + Thread.currentThread().threadId() : context.toolCallId();
        String turnId = context == null ? null : context.turnId();
        RunningNetworkCall call = runningCallRegistry.register(sessionId, turnId, toolCallId);
        try (NetworkConcurrencyLimiter.Permit ignored = concurrencyLimiter.acquire(sessionId, call, deadline)) {
            WebSearchResponseParser.ParsedSearch parsed = mcpClient.search(validated.query(), validated.maxResults(), deadline, call);
            if (System.nanoTime() >= deadline) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_TIMEOUT, "网络搜索超时");
            List<com.yu.mboocode.agent.tool.dto.WebSearchResult> results = parsed.results().stream().limit(validated.maxResults()).toList();
            long durationMs = Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
            WebSearchData data = new WebSearchData(validated.query(), "exa", parsed.structured(), results, parsed.providerContent(),
                    results.size(), parsed.truncated() || results.size() < parsed.results().size(), durationMs);
            return ToolResult.completed(data);
        } finally {
            runningCallRegistry.remove(call);
        }
    }
}
