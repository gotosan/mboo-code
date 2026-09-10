package com.yu.mboocode.agent.subagent;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.tool.permission.ToolPermission;
import com.yu.mboocode.agent.tool.permission.ToolPermissionType;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Component;
import java.util.List;

@Component
public class SubagentTools {
    @Resource
    private SubagentService service;

    @Tool(name = "spawn_agent", value = "委派子任务。在 message 说明目标、职责和范围，保留已有修改；冲突或扩围要求子 Agent 返回原因。explorer 只读默认后台；worker 固定前台。主 Agent 收齐结果并整体验证后才能最终回复。")
    @ToolPermission(ToolPermissionType.NONE)
    public String spawnAgent(@P("explorer 或 worker") String role, @P("自然语言委派任务") String message, @P(value = "是否继承当前请求输入快照，默认 false", required = false) Boolean fork, @P(value = "foreground/background", required = false) String mode) {
        return JSON.toJSONString(service.spawn(role, message, fork, mode));
    }

    @Tool(name = "send_agent_message", value = "向空闲子 Agent 追加任务并开始新 run；沿用子历史，忙碌返回 AGENT_BUSY。")
    @ToolPermission(ToolPermissionType.NONE)
    public String sendAgentMessage(@P("子会话 ID") String agentId, @P("自然语言任务") String message, @P(value = "foreground/background，worker 仅支持前台", required = false) String mode) {
        return JSON.toJSONString(service.send(agentId, message, mode));
    }

    @Tool(name = "wait_agents", value = "任一指定执行终止即返回全部指定状态及可用结果。下一次只等待尚未完成的 ID，超时不取消。")
    @ToolPermission(ToolPermissionType.NONE)
    public String waitAgents(@P("1～12 个不重复 runId") List<String> runIds, @P(value = "0～60000，默认 30000", required = false) Long timeoutMs) {
        return JSON.toJSONString(service.waitAgents(runIds, timeoutMs));
    }

    @Tool(name = "cancel_agent", value = "取消一个子执行并等待最多 10 秒清理确认。取消中不代表已经停止，历史与已落盘修改保留。")
    @ToolPermission(ToolPermissionType.NONE)
    public String cancelAgent(@P("子执行 runId") String runId) { return JSON.toJSONString(service.cancel(runId)); }
}
