package com.yu.mboocode.agent.tool.network;

import com.yu.mboocode.agent.tool.dto.NetworkErrorData;
import com.yu.mboocode.config.Setting;
import jakarta.annotation.PreDestroy;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

@Component
public class NetworkAccessPolicy {
    private static final Set<String> HARD_DENY_HOSTS = Set.of("metadata.google.internal");
    private final ExecutorService dnsExecutor = Executors.newVirtualThreadPerTaskExecutor();
    @Resource
    private NetworkAddressClassifier addressClassifier;
    @Resource
    private Setting setting;
    @Resource
    private UrlRedactor urlRedactor;

    public Inspection inspect(URI uri, long deadlineNanos) {
        return inspect(uri, deadlineNanos, true);
    }

    public Inspection inspectForRedirect(URI uri, long deadlineNanos) {
        return inspect(uri, deadlineNanos, false);
    }

    private Inspection inspect(URI uri, long deadlineNanos, boolean enforcePrivateGate) {
        String host = normalizeHost(uri.getHost());
        if (HARD_DENY_HOSTS.contains(host)) throw denied(uri, "系统禁止访问云平台元数据端点");
        InetAddress[] addresses = resolve(host, deadlineNanos, uri);
        boolean hasPublic = false;
        boolean hasPrivate = false;
        for (InetAddress address : addresses) {
            NetworkAddressClassifier.AddressClass addressClass = addressClassifier.classify(address);
            if (addressClass == NetworkAddressClassifier.AddressClass.HARD_DENY) throw denied(uri, "系统禁止访问当前网络目标");
            hasPublic |= addressClass == NetworkAddressClassifier.AddressClass.PUBLIC;
            hasPrivate |= addressClass == NetworkAddressClassifier.AddressClass.PRIVATE;
        }
        if (hasPublic && hasPrivate) {
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_MIXED_ADDRESS_DENIED, "目标同时解析到公共和私有地址，已拒绝访问", errorData(uri, false));
        }
        TargetClass targetClass = hasPrivate ? TargetClass.PRIVATE : TargetClass.PUBLIC;
        if (enforcePrivateGate && targetClass == TargetClass.PRIVATE && !Boolean.TRUE.equals(setting.getWebFetchPrivateNetworkEnabled())) {
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_PRIVATE_ACCESS_DISABLED, "私有网络抓取能力未启用", errorData(uri, false));
        }
        return new Inspection(uri, NetworkOrigin.from(uri), targetClass, addresses);
    }

    public Inspection inspectPublicOnly(URI uri, long deadlineNanos) {
        Inspection inspection = inspect(uri, deadlineNanos, false);
        if (inspection.targetClass() != TargetClass.PUBLIC) throw denied(uri, "搜索供应商目标不是公共网络地址");
        return inspection;
    }

    private InetAddress[] resolve(String host, long deadlineNanos, URI uri) {
        Future<InetAddress[]> future = dnsExecutor.submit(() -> InetAddress.getAllByName(host));
        try {
            long remaining = deadlineNanos - System.nanoTime();
            if (remaining <= 0) throw timeout(uri);
            InetAddress[] addresses = future.get(remaining, TimeUnit.NANOSECONDS);
            if (addresses == null || addresses.length == 0) throw dnsFailure(uri, "DNS 未返回有效地址", false, null);
            return Arrays.stream(addresses).distinct().toArray(InetAddress[]::new);
        } catch (java.util.concurrent.TimeoutException e) {
            future.cancel(true);
            throw timeout(uri);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new NetworkToolException(NetworkToolErrorCode.NETWORK_CANCELLED, "网络调用已取消", errorData(uri, false), e);
        } catch (java.util.concurrent.ExecutionException e) {
            Throwable cause = e.getCause();
            boolean retryable = cause instanceof UnknownHostException;
            throw dnsFailure(uri, "DNS 解析失败", retryable, cause);
        }
    }

    private NetworkToolException denied(URI uri, String message) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_TARGET_DENIED, message, errorData(uri, false));
    }

    private NetworkToolException timeout(URI uri) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_TIMEOUT, "网络调用超时", errorData(uri, true));
    }

    private NetworkToolException dnsFailure(URI uri, String message, boolean retryable, Throwable cause) {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_DNS_RESOLUTION_FAILED, message, errorData(uri, retryable), cause);
    }

    private NetworkErrorData errorData(URI uri, boolean retryable) {
        String safeUrl = urlRedactor.redact(uri);
        return new NetworkErrorData(null, safeUrl, safeUrl, null, retryable, null);
    }

    private String normalizeHost(String host) {
        if (host == null) return "";
        String value = host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
        return value.toLowerCase(Locale.ROOT);
    }

    @PreDestroy
    public void shutdown() {
        dnsExecutor.shutdownNow();
    }

    public record Inspection(URI uri, NetworkOrigin origin, TargetClass targetClass, InetAddress[] addresses) {
        public Inspection {
            addresses = addresses.clone();
        }

        @Override
        public InetAddress[] addresses() {
            return addresses.clone();
        }
    }

    public enum TargetClass {
        PUBLIC,
        PRIVATE
    }
}
