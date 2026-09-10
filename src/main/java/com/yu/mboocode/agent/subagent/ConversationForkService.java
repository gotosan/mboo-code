package com.yu.mboocode.agent.subagent;

import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.util.DateTimeUtil;
import com.yu.mboocode.llm.service.ChatMemoryService;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.*;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.annotation.Resource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** 公共对话分叉只传递序列化的不可变输入；不派生执行、权限或工作区关系。 */
@Service
public class ConversationForkService {
    @Resource
    private ChatMemoryService chatMemoryService;
    @Resource
    private SessionService sessionService;
    private final Map<String, Snapshot> toolSnapshots = new ConcurrentHashMap<>();

    public Snapshot freeze(String sourceSessionId, String turnId, int requestSequence, List<ChatMessage> actualMessages, String summary, String retained) {
        List<ChatMessage> history = actualMessages.stream().filter(message -> !(message instanceof SystemMessage)).toList();
        validatePairs(history);
        return new Snapshot(sourceSessionId, turnId, null, requestSequence, IdUtil.fastSimpleUUID(), 1, DateTimeUtil.now(), ChatMessageSerializer.messagesToJson(history), summary, retained);
    }

    public void bind(Snapshot snapshot, UUID invocationId, List<ToolExecutionRequest> requests) {
        Snapshot bound = new Snapshot(snapshot.sourceSessionId(), snapshot.sourceTurnId(), invocationId, snapshot.requestSequence(), snapshot.forkPointId(), snapshot.version(), snapshot.createdAt(), snapshot.messagesJson(), snapshot.summaryText(), snapshot.retainedToolResultsJson());
        for (ToolExecutionRequest request : requests) {
            if ("spawn_agent".equals(request.name())) toolSnapshots.put(key(snapshot.sourceSessionId(), snapshot.sourceTurnId(), request.id()), bound);
        }
    }

    public Snapshot captureSnapshot(String sourceSessionId, String turnId, String toolCallId) {
        Snapshot snapshot = toolSnapshots.get(key(sourceSessionId, turnId, toolCallId));
        if (snapshot == null) throw new SubagentException("FORK_SNAPSHOT_UNAVAILABLE", "找不到产生本次创建调用的模型请求输入快照");
        return snapshot;
    }

    @Transactional
    public void initializeContext(String targetSessionId, Snapshot snapshot, String accessingSessionId) {
        if (!snapshot.sourceSessionId().equals(accessingSessionId)) throw new SubagentException("AGENT_ACCESS_DENIED", "无权读取分叉来源");
        sessionService.getSession(accessingSessionId);
        var target = sessionService.getSession(targetSessionId);
        var identity = AgentIdentity.from(target);
        if (identity == null || !snapshot.forkPointId().equals(identity.forkPointId()) || !snapshot.sourceSessionId().equals(identity.forkSourceSessionId())) throw new SubagentException("AGENT_ACCESS_DENIED", "目标会话未绑定该分叉来源");
        if (chatMemoryService.getById(targetSessionId) != null) throw new SubagentException("AGENT_BUSY", "目标会话已初始化，不能重复分叉");
        // 历史保留原义，但移除 Skill 激活能力标记；目标必须按自身目录重新激活。
        var messages = ChatMessageDeserializer.messagesFromJson(snapshot.messagesJson()).stream().map(message -> {
            if (message instanceof ToolExecutionResultMessage result && result.attributes().containsKey("activated_skill")) {
                Map<String, Object> attributes = new LinkedHashMap<>(result.attributes());
                attributes.remove("activated_skill");
                return (ChatMessage) ToolExecutionResultMessage.builder().id(result.id()).toolName(result.toolName()).contents(result.contents()).attributes(attributes).build();
            }
            return message;
        }).toList();
        String retained = snapshot.retainedToolResultsJson();
        if (retained != null && !retained.isBlank()) {
            var root = JSON.parseObject(retained);
            var entries = root.getJSONArray("entries");
            if (entries != null) entries.removeIf(value -> value instanceof com.alibaba.fastjson2.JSONObject entry && entry.getJSONObject("attributes") != null && entry.getJSONObject("attributes").containsKey("activated_skill"));
            retained = root.toJSONString();
        }
        var memory = new com.yu.mboocode.llm.model.ChatMemory();
        memory.setMemoryId(targetSessionId);
        memory.setMessagesJson(ChatMessageSerializer.messagesToJson(messages));
        memory.setSummaryText(snapshot.summaryText());
        memory.setRetainedToolResultsJson(retained);
        memory.setUpdatedAt(DateTimeUtil.now());
        chatMemoryService.save(memory);
    }

    public void release(String sessionId, String turnId, String toolCallId) { toolSnapshots.remove(key(sessionId, turnId, toolCallId)); }
    public void releaseTurn(String sessionId, String turnId) { toolSnapshots.keySet().removeIf(key -> key.startsWith(sessionId + ":" + turnId + ":")); }
    private String key(String sessionId, String turnId, String toolCallId) { return sessionId + ":" + turnId + ":" + toolCallId; }

    private void validatePairs(List<ChatMessage> messages) {
        Set<String> pending = new HashSet<>();
        for (ChatMessage message : messages) {
            if (message instanceof ToolExecutionResultMessage result) {
                if (!pending.remove(result.id())) throw new SubagentException("FORK_SNAPSHOT_UNAVAILABLE", "分叉输入包含孤立工具结果");
            } else {
                if (!pending.isEmpty()) throw new SubagentException("FORK_SNAPSHOT_UNAVAILABLE", "分叉输入包含未完成工具调用组");
                if (message instanceof AiMessage ai && ai.hasToolExecutionRequests()) {
                    for (var request : ai.toolExecutionRequests()) if (!pending.add(request.id())) throw new SubagentException("FORK_SNAPSHOT_UNAVAILABLE", "工具调用组 ID 重复");
                }
            }
        }
        if (!pending.isEmpty()) throw new SubagentException("FORK_SNAPSHOT_UNAVAILABLE", "分叉输入包含未完成工具调用组");
    }

    @Schema(description = "不可变模型请求输入快照")
    public record Snapshot(@Schema(description = "来源会话") String sourceSessionId, @Schema(description = "来源轮次") String sourceTurnId,
                           @Schema(description = "来源模型调用") UUID invocationId, @Schema(description = "该轮实际模型请求序号") int requestSequence,
                           @Schema(description = "请求截点唯一 ID") String forkPointId, @Schema(description = "快照结构版本") int version,
                           @Schema(description = "创建时间") String createdAt, @Schema(description = "完整历史消息序列化副本") String messagesJson,
                           @Schema(description = "同版本摘要") String summaryText, @Schema(description = "同版本保留结果") String retainedToolResultsJson) {}
}
