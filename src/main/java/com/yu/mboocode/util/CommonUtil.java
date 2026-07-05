package com.yu.mboocode.util;

public class CommonUtil {
    public static String getAppDataDir() {
        String appDataDir = System.getProperty("mboo.appDataDir");
        if (appDataDir != null && !appDataDir.isBlank()) {
            return appDataDir;
        }
        return System.getProperty("user.home") + "/.mboo";
    }
}
