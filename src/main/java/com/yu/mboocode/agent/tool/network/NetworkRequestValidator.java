package com.yu.mboocode.agent.tool.network;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.agent.tool.ToolRequestValidator;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.net.IDN;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;

@Component
public class NetworkRequestValidator implements ToolRequestValidator {
    public static final int MAX_URL_LENGTH = 8192;
    private static final Set<String> TOOLS = Set.of("web_search", "web_fetch");
    @Resource
    private NetworkAccessPolicy accessPolicy;

    @Override
    public boolean supports(String toolName) {
        return TOOLS.contains(toolName);
    }

    @Override
    public void validate(String sessionId, ToolExecutionRequest request) {
        JSONObject arguments = parseArguments(request.arguments());
        if ("web_search".equals(request.name())) {
            validateSearch(arguments);
        } else if ("web_fetch".equals(request.name())) {
            WebFetchArguments fetch = validateFetch(arguments);
            accessPolicy.inspect(fetch.url(), System.nanoTime() + java.time.Duration.ofSeconds(10).toNanos());
        }
    }

    public WebSearchArguments validateSearch(JSONObject arguments) {
        String query = requiredString(arguments, "query").trim();
        if (query.isEmpty() || query.length() > 1000) throw invalid("query 去除首尾空白后长度必须在 1 到 1000 之间");
        int maxResults = integer(arguments, "maxResults", 8, 1, 20);
        return new WebSearchArguments(query, maxResults);
    }

    public WebFetchArguments validateFetch(JSONObject arguments) {
        URI url = normalizeUrl(requiredString(arguments, "url"));
        String format = optionalString(arguments, "format", "markdown").toLowerCase(Locale.ROOT);
        if (!"markdown".equals(format) && !"text".equals(format)) throw invalid("format 只允许 markdown 或 text");
        int offset = integer(arguments, "offset", 1, 1, Integer.MAX_VALUE);
        int limit = integer(arguments, "limit", 300, 1, 1000);
        int timeoutSeconds = integer(arguments, "timeoutSeconds", 30, 1, 120);
        return new WebFetchArguments(url, format, offset, limit, timeoutSeconds);
    }

    public URI normalizeUrl(String rawUrl) {
        if (rawUrl == null) throw invalid("缺少参数：url");
        String value = rawUrl.trim();
        if (value.isEmpty() || value.length() > MAX_URL_LENGTH) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 不能为空且长度不能超过 8192 个字符");
        if (value.chars().anyMatch(character -> Character.isISOControl(character))) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 不能包含控制字符");
        try {
            URI parsed = new URI(value);
            String scheme = parsed.getScheme() == null ? null : parsed.getScheme().toLowerCase(Locale.ROOT);
            if (!parsed.isAbsolute() || (!"http".equals(scheme) && !"https".equals(scheme))) {
                throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "只支持完整的 HTTP/HTTPS URL");
            }
            if (parsed.getRawUserInfo() != null) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 不能包含 user-info");
            HostPort hostPort = resolveHostPort(parsed);
            String host = normalizeHost(hostPort.host());
            int port = hostPort.port() >= 0 ? hostPort.port() : "https".equals(scheme) ? 443 : 80;
            if (port < 1 || port > 65535) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 端口无效");
            String rawPath = parsed.getRawPath();
            if (rawPath == null || rawPath.isEmpty()) rawPath = "/";
            String renderedHost = host.contains(":") ? "[" + host + "]" : host;
            String normalized = scheme + "://" + renderedHost + (hostPort.port() >= 0 ? ":" + hostPort.port() : "") + rawPath;
            if (parsed.getRawQuery() != null) normalized += "?" + parsed.getRawQuery();
            return new URI(normalized).normalize();
        } catch (NetworkToolException e) {
            throw e;
        } catch (IllegalArgumentException | URISyntaxException e) {
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 格式无效", null, e);
        }
    }

    public JSONObject parseArguments(String json) {
        try {
            JSONObject arguments = JSON.parseObject(json);
            if (arguments == null) throw invalid("工具参数必须是 JSON 对象");
            return arguments;
        } catch (NetworkToolException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new NetworkToolException(NetworkToolErrorCode.INVALID_ARGUMENT, "工具参数 JSON 格式错误", null, e);
        }
    }

    private HostPort resolveHostPort(URI uri) {
        if (uri.getHost() != null) return new HostPort(stripBrackets(uri.getHost()), uri.getPort());
        String authority = uri.getRawAuthority();
        if (authority == null || authority.isBlank()) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 必须包含主机名");
        if (authority.startsWith("[")) {
            int close = authority.indexOf(']');
            if (close < 0) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "IPv6 URL 格式无效");
            String host = authority.substring(1, close);
            if (close + 1 == authority.length()) return new HostPort(host, -1);
            if (authority.charAt(close + 1) != ':') throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 主机格式无效");
            return new HostPort(host, parsePort(authority.substring(close + 2)));
        }
        int colon = authority.lastIndexOf(':');
        if (colon > 0 && authority.indexOf(':') == colon) return new HostPort(authority.substring(0, colon), parsePort(authority.substring(colon + 1)));
        return new HostPort(authority, -1);
    }

    private String normalizeHost(String rawHost) {
        String host = stripBrackets(rawHost);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isBlank()) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 必须包含主机名");
        try {
            if (host.contains(":")) {
                if (host.contains("%")) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "IPv6 URL 不支持作用域标识");
                InetAddress address = InetAddress.getByName(host);
                if (!(address instanceof Inet6Address)) throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "IPv6 地址无效");
                return address.getHostAddress().split("%", 2)[0].toLowerCase(Locale.ROOT);
            }
            return IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES).toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException | java.net.UnknownHostException e) {
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 主机名无效", null, e);
        }
    }

    private String requiredString(JSONObject arguments, String name) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) throw invalid("缺少参数：" + name);
        Object value = arguments.get(name);
        if (!(value instanceof String text)) throw invalid("参数 " + name + " 必须是字符串");
        return text;
    }

    private String optionalString(JSONObject arguments, String name, String defaultValue) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return defaultValue;
        Object value = arguments.get(name);
        if (!(value instanceof String text)) throw invalid("参数 " + name + " 必须是字符串");
        return text;
    }

    private int integer(JSONObject arguments, String name, int defaultValue, int min, int max) {
        if (!arguments.containsKey(name) || arguments.get(name) == null) return defaultValue;
        Object raw = arguments.get(name);
        if (!(raw instanceof Number number)) throw invalid("参数 " + name + " 必须是整数");
        long value = number.longValue();
        if (number.doubleValue() != value || value < min || value > max) throw invalid("参数 " + name + " 超出允许范围");
        return (int) value;
    }

    private int parsePort(String text) {
        try {
            return Integer.parseInt(text);
        } catch (NumberFormatException e) {
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_INVALID_URL, "URL 端口无效", null, e);
        }
    }

    private String stripBrackets(String host) {
        return host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
    }

    private NetworkToolException invalid(String message) {
        return new NetworkToolException(NetworkToolErrorCode.INVALID_ARGUMENT, message);
    }

    public record WebSearchArguments(String query, int maxResults) {
    }

    public record WebFetchArguments(URI url, String format, int offset, int limit, int timeoutSeconds) {
    }

    private record HostPort(String host, int port) {
    }
}
