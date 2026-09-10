package com.yu.mboocode.agent.subagent;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.ToolException;
import java.util.Map;

public class SubagentException extends ToolException {
    public SubagentException(String code, String message) {
        super(JSON.toJSONString(Map.of("success", false, "status", "FAILED", "errorCode", code, "message", message)));
    }
    @Override
    public String toResultJson() { return getMessage(); }
}
