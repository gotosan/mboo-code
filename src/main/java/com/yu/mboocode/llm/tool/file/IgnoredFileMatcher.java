package com.yu.mboocode.llm.tool.file;

import cn.hutool.core.util.StrUtil;
import com.yu.mboocode.config.Setting;
import org.springframework.stereotype.Component;

import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

@Component
public class IgnoredFileMatcher {
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    private final List<CompiledPattern> ignoredPatterns;
    private final List<CompiledPattern> exceptionPatterns;
    private final List<String> ignoredRgGlobs;
    private final List<String> exceptionRgGlobs;

    public IgnoredFileMatcher(Setting setting) {
        List<String> ignored = normalizeRules(setting.getIgnoredFilePatterns());
        List<String> exceptions = normalizeRules(setting.getIgnoredFilePatternExceptions());
        this.ignoredPatterns = compile(ignored, "ignored_file_patterns");
        this.exceptionPatterns = compile(exceptions, "ignored_file_pattern_exceptions");
        this.ignoredRgGlobs = ignored;
        this.exceptionRgGlobs = exceptions;
    }

    public boolean isIgnored(Path path) {
        String normalizedPath = normalizeValue(path.toAbsolutePath().normalize().toString().replace('\\', '/'));
        String fileName = path.getFileName() == null ? normalizedPath : normalizeValue(path.getFileName().toString());
        if (matches(exceptionPatterns, normalizedPath, fileName)) {
            return false;
        }
        return matches(ignoredPatterns, normalizedPath, fileName);
    }

    public List<String> ignoredRgGlobs() {
        return ignoredRgGlobs;
    }

    public List<String> exceptionRgGlobs() {
        return exceptionRgGlobs;
    }

    private List<String> normalizeRules(List<String> rules) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        if (rules != null) {
            for (String rule : rules) {
                String value = StrUtil.trim(rule);
                if (StrUtil.isNotBlank(value)) {
                    values.add(value.replace('\\', '/'));
                }
            }
        }
        return List.copyOf(values);
    }

    private List<CompiledPattern> compile(List<String> rules, String settingName) {
        List<CompiledPattern> result = new ArrayList<>();
        for (String rawRule : rules) {
            String rule = normalizeValue(rawRule);
            boolean filenameOnly = !rule.contains("/");
            try {
                result.add(new CompiledPattern(filenameOnly, FileSystems.getDefault().getPathMatcher("glob:" + rule)));
            } catch (RuntimeException e) {
                throw new IllegalStateException("配置项 " + settingName + " 包含非法 glob：" + rawRule, e);
            }
        }
        return List.copyOf(result);
    }

    private boolean matches(List<CompiledPattern> patterns, String normalizedPath, String fileName) {
        for (CompiledPattern pattern : patterns) {
            Path value = Path.of(pattern.filenameOnly() ? fileName : normalizedPath);
            if (pattern.matcher().matches(value)) {
                return true;
            }
        }
        return false;
    }

    private String normalizeValue(String value) {
        return WINDOWS ? value.toLowerCase(Locale.ROOT) : value;
    }

    private record CompiledPattern(boolean filenameOnly, PathMatcher matcher) {
    }
}
