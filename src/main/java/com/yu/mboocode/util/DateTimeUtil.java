package com.yu.mboocode.util;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.concurrent.TimeUnit;

public class DateTimeUtil {
    public static String now() {
        return OffsetDateTime.now(ZoneOffset.UTC).toString();
    }

    public static long durationMs(long startNano) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNano);
    }
}
