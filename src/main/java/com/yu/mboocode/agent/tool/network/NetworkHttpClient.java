package com.yu.mboocode.agent.tool.network;

import com.yu.mboocode.agent.tool.dto.NetworkErrorData;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpUriRequestBase;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.http.Header;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.http.io.entity.ByteArrayEntity;
import org.apache.hc.core5.http.impl.NoConnectionReuseStrategy;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@Component
public class NetworkHttpClient {
    @Resource
    private UrlRedactor urlRedactor;
    private final PinnedDnsResolver dnsResolver = new PinnedDnsResolver();
    private final CloseableHttpClient client = HttpClients.custom()
            .setConnectionManager(PoolingHttpClientConnectionManagerBuilder.create()
                    .setDnsResolver(dnsResolver)
                    .setMaxConnTotal(4)
                    .setMaxConnPerRoute(4)
                    .build())
            .disableRedirectHandling()
            .disableCookieManagement()
            .disableAuthCaching()
            .disableAutomaticRetries()
            .setConnectionReuseStrategy(NoConnectionReuseStrategy.INSTANCE)
            .build();

    public Response execute(NetworkAccessPolicy.Inspection inspection, String method, byte[] body, ContentType bodyType,
                            Map<String, String> headers, int maxBytes, long deadlineNanos, RunningNetworkCall call) {
        ensureActive(deadlineNanos, call, inspection.uri());
        HttpUriRequestBase request = new HttpUriRequestBase(method, inspection.uri());
        long remainingMs = Math.max(1, TimeUnit.NANOSECONDS.toMillis(deadlineNanos - System.nanoTime()));
        request.setConfig(RequestConfig.custom()
                .setRedirectsEnabled(false)
                .setAuthenticationEnabled(false)
                .setConnectionRequestTimeout(Timeout.ofMilliseconds(remainingMs))
                .setConnectTimeout(Timeout.ofMilliseconds(remainingMs))
                .setResponseTimeout(Timeout.ofMilliseconds(remainingMs))
                .setHardCancellationEnabled(true)
                .build());
        headers.forEach(request::setHeader);
        if (body != null) request.setEntity(new ByteArrayEntity(body, bodyType == null ? ContentType.APPLICATION_OCTET_STREAM : bodyType));
        call.bind(request);
        dnsResolver.bind(inspection.uri().getHost(), inspection.addresses());
        try {
            return client.execute(request, response -> {
                ensureActive(deadlineNanos, call, inspection.uri());
                HttpEntity entity = response.getEntity();
                long contentLength = entity == null ? 0 : entity.getContentLength();
                if (contentLength > maxBytes) throw tooLarge(inspection.uri());
                Map<String, String> responseHeaders = new LinkedHashMap<>();
                for (Header header : response.getHeaders()) responseHeaders.putIfAbsent(header.getName().toLowerCase(Locale.ROOT), header.getValue());
                byte[] bytes = entity == null ? new byte[0] : readBounded(entity.getContent(), maxBytes, deadlineNanos, call, inspection.uri());
                return new Response(response.getCode(), responseHeaders, bytes);
            });
        } catch (NetworkToolException e) {
            throw e;
        } catch (IOException e) {
            if (call.cancelled() || Thread.currentThread().isInterrupted()) throw cancelled(inspection.uri(), e);
            if (System.nanoTime() >= deadlineNanos) throw timeout(inspection.uri(), e);
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_REQUEST_FAILED, "网络请求失败", errorData(inspection.uri(), true), e);
        } finally {
            dnsResolver.clear();
            call.unbind(request);
        }
    }

    private byte[] readBounded(InputStream input, int maxBytes, long deadlineNanos, RunningNetworkCall call, URI uri) throws IOException {
        try (input; ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(maxBytes, 8192))) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int count;
            while ((count = input.read(buffer)) >= 0) {
                ensureActive(deadlineNanos, call, uri);
                if (count == 0) continue;
                total += count;
                if (total > maxBytes) throw tooLarge(uri);
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private void ensureActive(long deadlineNanos, RunningNetworkCall call, URI uri) {
        if (call.cancelled() || Thread.currentThread().isInterrupted()) throw cancelled(uri, null);
        if (System.nanoTime() >= deadlineNanos) throw timeout(uri, null);
    }

    private NetworkToolException tooLarge(URI uri) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_RESPONSE_TOO_LARGE, "网络响应体超过允许上限", errorData(uri, false));
    }

    private NetworkToolException timeout(URI uri, Throwable cause) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_TIMEOUT, "网络调用超时", errorData(uri, true), cause);
    }

    private NetworkToolException cancelled(URI uri, Throwable cause) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_CANCELLED, "网络调用已取消", errorData(uri, false), cause);
    }

    private NetworkErrorData errorData(URI uri, boolean retryable) {
        String safeUrl = urlRedactor.redact(uri);
        return new NetworkErrorData(null, safeUrl, safeUrl, null, retryable, null);
    }

    @PreDestroy
    public void close() throws IOException {
        client.close();
    }

    public record Response(int statusCode, Map<String, String> headers, byte[] body) {
        public String header(String name) {
            return headers.get(name.toLowerCase(Locale.ROOT));
        }
    }

    private static final class PinnedDnsResolver implements DnsResolver {
        private final ThreadLocal<PinnedAddresses> current = new ThreadLocal<>();

        private void bind(String host, InetAddress[] addresses) {
            current.set(new PinnedAddresses(normalize(host), addresses.clone()));
        }

        private void clear() {
            current.remove();
        }

        @Override
        public InetAddress[] resolve(String host) throws UnknownHostException {
            PinnedAddresses pinned = current.get();
            if (pinned == null || !pinned.host().equals(normalize(host))) throw new UnknownHostException("当前请求没有固定 DNS 结果");
            return pinned.addresses().clone();
        }

        @Override
        public String resolveCanonicalHostname(String host) {
            return host;
        }

        private String normalize(String host) {
            if (host == null) return "";
            String value = host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
            return value.toLowerCase(Locale.ROOT);
        }

        private record PinnedAddresses(String host, InetAddress[] addresses) {
        }
    }
}
