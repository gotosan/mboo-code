package com.yu.mboocode.agent.subagent;

import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.common.dto.R;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.HashMap;
import io.swagger.v3.oas.annotations.media.Schema;

@RestController
@RequestMapping("/session/{parentSessionId}")
@Tag(name = "子 Agent")
public class SubagentController {
    @Resource
    private SessionService sessionService;
    @Resource
    private SubagentRunStore store;
    @Resource
    private SubagentService service;

    @GetMapping("/subagents")
    @Operation(summary = "查询子会话及最近执行概况")
    public R<List<AgentOverview>> agents(@PathVariable String parentSessionId) {
        List<Sessions> children = sessionService.childSessions(parentSessionId);
        Map<String, SubagentRun> latest = new HashMap<>();
        for (SubagentRun run : store.byParent(parentSessionId, null)) latest.put(run.getAgentId(), run);
        return R.ok(children.stream().map(child -> new AgentOverview(child, latest.get(child.getId()))).toList());
    }

    @Schema(description = "子会话及其最近一次执行")
    public record AgentOverview(@Schema(description = "子会话") Sessions session, @Schema(description = "最近执行，没有执行时为空") SubagentRun latestRun) {}

    @GetMapping("/subagent-runs")
    @Operation(summary = "查询子执行持久状态")
    public R<List<SubagentRun>> runs(@PathVariable String parentSessionId, @RequestParam(required = false) String turnId) {
        sessionService.requireMainSession(parentSessionId);
        return R.ok(store.byParent(parentSessionId, turnId));
    }

    @PostMapping("/subagent-runs/{runId}/cancel")
    @Operation(summary = "停止受管理的指定子执行，最多等待 10 秒清理确认")
    public R<SubagentRun> cancel(@PathVariable String parentSessionId, @PathVariable String runId) {
        sessionService.requireMainSession(parentSessionId);
        return R.ok(service.cancelManaged(parentSessionId, runId));
    }
}
