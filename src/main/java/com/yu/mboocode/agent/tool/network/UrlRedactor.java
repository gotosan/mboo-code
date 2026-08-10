package com.yu.mboocode.agent.tool.network;

import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

@Component
public class UrlRedactor {
    private static final Set<String> SENSITIVE_NAMES = Set.of(
            "token", "access_token", "api_key", "apikey", "key", "secret", "password",
            "signature", "sig", "x-amz-signature", "x-goog-signature", "credential", "exaapikey"
    );

    public String redact(URI uri) {
        if (uri == null) return null;
        String value = uri.toASCIIString();
        String rawQuery = uri.getRawQuery();
        if (rawQuery == null || rawQuery.isEmpty()) return value;
        StringBuilder safeQuery = new StringBuilder();
        for (String part : rawQuery.split("&", -1)) {
            if (!safeQuery.isEmpty()) safeQuery.append('&');
            int equals = part.indexOf('=');
            String rawName = equals >= 0 ? part.substring(0, equals) : part;
            safeQuery.append(rawName);
            if (equals >= 0) safeQuery.append('=').append(isSensitive(rawName) ? "***" : part.substring(equals + 1));
        }
        int queryIndex = value.indexOf('?');
        return queryIndex < 0 ? value : value.substring(0, queryIndex + 1) + safeQuery;
    }

    private boolean isSensitive(String rawName) {
        try {
            String name = URLDecoder.decode(rawName, StandardCharsets.UTF_8).toLowerCase(Locale.ROOT);
            return SENSITIVE_NAMES.contains(name);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
