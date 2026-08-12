package com.yu.mboocode.llm.prompt;

import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter;
import com.yu.mboocode.agent.tool.command.ResolvedCommand;
import com.yu.mboocode.agent.tool.command.ShellResolver;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 生成单个执行 turn 使用的运行环境上下文。
 */
@Component
public class RuntimeEnvironmentProvider {
    private static final String UNKNOWN = "unknown";
    private static final String UNAVAILABLE = "unavailable";

    @Resource
    private ShellResolver shellResolver;

    public String capture(String workspacePath) {
        Map<String, Object> environment = new LinkedHashMap<>();
        environment.put("workspacePath", StrUtil.blankToDefault(workspacePath, UNKNOWN));

        Map<String, String> operatingSystem = new LinkedHashMap<>();
        operatingSystem.put("name", systemProperty("os.name"));
        operatingSystem.put("version", systemProperty("os.version"));
        operatingSystem.put("architecture", systemProperty("os.arch"));
        environment.put("operatingSystem", operatingSystem);

        Map<String, String> shell = new LinkedHashMap<>();
        try {
            ResolvedCommand.ShellIdentity identity = shellResolver.resolve();
            shell.put("type", identity.type() == ResolvedCommand.ShellType.POWERSHELL ? "powershell" : "posix");
            shell.put("executable", identity.executable().toString());
        } catch (RuntimeException e) {
            shell.put("type", UNAVAILABLE);
            shell.put("executable", UNAVAILABLE);
        }
        environment.put("shell", shell);

        try {
            ZoneId zoneId = ZoneId.systemDefault();
            environment.put("currentDate", LocalDate.now(zoneId).toString());
            environment.put("timezone", StrUtil.blankToDefault(zoneId.getId(), UNKNOWN));
        } catch (RuntimeException e) {
            environment.put("currentDate", UNKNOWN);
            environment.put("timezone", UNKNOWN);
        }

        String json = JSON.toJSONString(environment, JSONWriter.Feature.PrettyFormat);
        return "<runtime-environment>\n" + json + "\n</runtime-environment>";
    }

    private String systemProperty(String name) {
        try {
            return StrUtil.blankToDefault(System.getProperty(name), UNKNOWN);
        } catch (RuntimeException e) {
            return UNKNOWN;
        }
    }
}
