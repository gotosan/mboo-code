package com.yu.mboocode.agent.tool.network;

import java.net.URI;

public record NetworkOrigin(String scheme, String host, int port) {
    public static NetworkOrigin from(URI uri) {
        int effectivePort = uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
        return new NetworkOrigin(uri.getScheme().toLowerCase(), normalizeHost(uri.getHost()), effectivePort);
    }

    @Override
    public String toString() {
        String renderedHost = host.contains(":") ? "[" + host + "]" : host;
        return scheme + "://" + renderedHost + ":" + port;
    }

    private static String normalizeHost(String host) {
        if (host == null) return "";
        return host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1).toLowerCase() : host.toLowerCase();
    }
}
