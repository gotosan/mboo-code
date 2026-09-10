package com.yu.mboocode.agent.subagent;

import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.model.Sessions;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "会话扩展数据中的 Agent 身份和分叉来源")
public record AgentIdentity(@Schema(description = "会话类型") String sessionKind, @Schema(description = "固定角色") String agentRole,
                            @Schema(description = "管理父会话") String parentSessionId, @Schema(description = "对话来源") String forkSourceSessionId,
                            @Schema(description = "确定请求截点") String forkPointId) {
    public static AgentIdentity from(Sessions session) {
        var metadata = session.getMetadataJson() == null ? null : JSON.parseObject(session.getMetadataJson());
        return metadata == null ? null : metadata.getObject("agent", AgentIdentity.class);
    }

    public static boolean isChild(Sessions session) {
        AgentIdentity identity = from(session);
        return identity != null && "subagent".equals(identity.sessionKind());
    }
}
