package com.yu.mboocode.agent.tool.command;

import cn.hutool.crypto.digest.DigestUtil;
import lombok.experimental.UtilityClass;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

@UtilityClass
public class CommandFingerprintUtil {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    public static String create(ResolvedCommand command) {
        String shell = normalize(command.shell().value());
        String workdir = normalize(command.workdir().toString());
        String source = "v1\0" + shell + "\0" + workdir + "\0" + command.command();
        return "v1:" + DigestUtil.sha256Hex(source.getBytes(StandardCharsets.UTF_8));
    }

    private static String normalize(String value) {
        return WINDOWS ? value.toLowerCase(Locale.ROOT) : value;
    }
}
