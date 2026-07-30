package com.yu.mboocode.agent.tool;

import org.springframework.stereotype.Component;

@Component
public class ToolTextTruncator {
    public static final int EVENT_RESULT_MAX_LENGTH = 4_000;

    public TruncatedText truncateMiddle(String text, int maxLength) {
        String value = text == null ? "" : text;
        if (value.length() <= maxLength) return new TruncatedText(value, false, 0);
        if (maxLength <= 0) return new TruncatedText("", true, value.length());
        int omitted = value.length() - maxLength;
        String marker = marker(omitted);
        if (marker.length() >= maxLength) return new TruncatedText(marker.substring(0, maxLength), true, value.length());
        int available = maxLength - marker.length();
        omitted = value.length() - available;
        marker = marker(omitted);
        available = Math.max(0, maxLength - marker.length());
        int head = available / 2;
        int tail = available - head;
        return new TruncatedText(value.substring(0, head) + marker + value.substring(value.length() - tail), true, omitted);
    }

    public String marker(long omittedCharacters) {
        return "\n...（已截断，省略 " + omittedCharacters + " 个字符）...\n";
    }

    public record TruncatedText(String text, boolean truncated, long omittedCharacters) {
    }
}
