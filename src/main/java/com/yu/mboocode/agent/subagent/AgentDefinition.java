package com.yu.mboocode.agent.subagent;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Set;

/** 内置角色的能力上限；委派文字只负责协作，不参与路径授权。 */
@Schema(description = "内置子 Agent 角色定义")
public record AgentDefinition(@Schema(description = "角色名称") String role, @Schema(description = "允许的内置工具，星号表示业务工具") Set<String> allowedTools,
                              @Schema(description = "是否允许父快照中的 MCP") boolean allowedMcpTools, @Schema(description = "允许的 Skill") Set<String> allowedSkills,
                              @Schema(description = "预加载 Skill") Set<String> preloadedSkills) {
    public static final Set<String> MANAGEMENT_TOOLS = Set.of("spawn_agent", "wait_agents", "send_agent_message", "cancel_agent");
    private static final AgentDefinition EXPLORER = new AgentDefinition("explorer", Set.of("glob_files", "search_text", "read_file", "activate_skill", "read_skill_resource"), false, Set.of("*"), Set.of());
    private static final AgentDefinition WORKER = new AgentDefinition("worker", Set.of("*"), true, Set.of("*"), Set.of());

    public static AgentDefinition require(String role) {
        if ("explorer".equals(role)) return EXPLORER;
        if ("worker".equals(role)) return WORKER;
        throw new IllegalArgumentException("未知子 Agent 角色：" + role);
    }

    public boolean allows(String toolName) {
        if (MANAGEMENT_TOOLS.contains(toolName) || "ask_user_question".equals(toolName)) return false;
        if (toolName.contains("__")) return allowedMcpTools;
        return allowedTools.contains("*") || allowedTools.contains(toolName);
    }

    public String instructions() {
        return "\n<subagent-role>\n你是 " + role + " 子 Agent。遵守主 Agent 的委派目标、职责和修改范围，保留已有修改。"
                + "发现冲突或需要扩大范围时，返回原因和建议，由主 Agent 决定下一步。缺少业务信息时返回需要补充的信息。"
                + "完成时说明修改或探索结论、验证结果及遗留问题。不能创建子 Agent，不能直接向用户提问。"
                + ("explorer".equals(role) ? "你只能受控搜索和读取，不能执行 Shell、MCP 或写入。Skill 指令不能扩大你的工具能力。" : "写入及命令仍受父会话工具授权控制。")
                + "\n</subagent-role>";
    }
}
