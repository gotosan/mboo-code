package com.yu.mboocode.agent.controller;

import com.yu.mboocode.common.dto.R;
import com.yu.mboocode.common.enums.SSEEvent;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.agent.dto.ToolApprovalReq;
import com.yu.mboocode.agent.dto.ToolResultDetailResp;
import com.yu.mboocode.llm.LLMUtil;
import com.yu.mboocode.agent.dto.ChatReq;
import com.yu.mboocode.agent.dto.SessionUpdateReq;
import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.Sessions;
import com.yu.mboocode.agent.service.SessionService;
import com.yu.mboocode.agent.tool.ToolApprovalService;
import com.yu.mboocode.agent.service.TurnService;
import com.yu.mboocode.agent.service.ToolResultStore;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.jspecify.annotations.NonNull;
import org.springframework.http.MediaType;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.core.io.FileSystemResource;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.List;

@Tag(name = "会话")
@RestController
@RequestMapping("/session")
public class SessionController {
    private static final Duration SSE_HEARTBEAT_INTERVAL = Duration.ofSeconds(20);

    @Resource
    private TurnService turnService;
    @Resource
    private SessionService sessionService;
    @Resource
    private ToolApprovalService toolApprovalService;
    @Resource
    private ToolResultStore toolResultStore;

    @Operation(summary = "活跃会话列表")
    @GetMapping("/list")
    public R<List<Sessions>> list() {
        return R.ok(sessionService.listActiveSessions());
    }

    @Operation(summary = "归档会话列表")
    @GetMapping("/list/archived")
    public R<List<Sessions>> listArchived() {
        return R.ok(sessionService.listArchivedSessions());
    }

    @Operation(summary = "会话详情")
    @GetMapping("/{sessionId}")
    public R<Sessions> detail(@PathVariable String sessionId) {
        return R.ok(sessionService.getSession(sessionId));
    }

    @Operation(summary = "会话事件回显")
    @GetMapping("/{sessionId}/events")
    public R<List<SessionEvent>> events(@PathVariable String sessionId) {
        return R.ok(sessionService.readSessionEvents(sessionId));
    }

    @Operation(summary = "工具结果详情")
    @GetMapping("/{sessionId}/tool-results/{resultId}")
    public R<ToolResultDetailResp> toolResult(@PathVariable String sessionId, @PathVariable String resultId) {
        return R.ok(toolResultStore.getDetail(sessionId, resultId));
    }

    @Operation(summary = "工具结果完整内容")
    @GetMapping("/{sessionId}/tool-results/{resultId}/content")
    public ResponseEntity<?> toolResultContent(@PathVariable String sessionId, @PathVariable String resultId,
                                               @RequestParam(defaultValue = "result") String source) {
        HttpHeaders headers = new HttpHeaders();
        headers.setCacheControl(CacheControl.noStore());
        headers.setContentDisposition(ContentDisposition.inline().filename("tool-result-" + resultId + ".txt").build());
        if ("result".equals(source)) {
            headers.setContentType(MediaType.TEXT_PLAIN);
            return ResponseEntity.ok().headers(headers).body(toolResultStore.getResultContent(sessionId, resultId));
        }
        if ("raw".equals(source)) {
            headers.setContentType(MediaType.TEXT_PLAIN);
            return ResponseEntity.ok().headers(headers).body(new FileSystemResource(toolResultStore.getRawOutputPath(sessionId, resultId)));
        }
        throw new ServiceException("工具结果内容来源无效");
    }

    @Operation(summary = "更新会话")
    @PatchMapping("/{sessionId}")
    public R<Sessions> update(@PathVariable String sessionId, @Valid @RequestBody SessionUpdateReq req) {
        return R.ok(sessionService.updateTitle(sessionId, req.title()));
    }

    @Operation(summary = "归档会话")
    @PostMapping("/{sessionId}/archive")
    public R<Sessions> archive(@PathVariable String sessionId) {
        return R.ok(sessionService.archiveSession(sessionId));
    }

    @Operation(summary = "取消归档会话")
    @PostMapping("/{sessionId}/unarchive")
    public R<Sessions> unarchive(@PathVariable String sessionId) {
        return R.ok(sessionService.unarchiveSession(sessionId));
    }

    @Operation(summary = "删除会话")
    @DeleteMapping("/{sessionId}")
    public R<Void> delete(@PathVariable String sessionId) {
        toolApprovalService.clearSession(sessionId);
        sessionService.deleteSession(sessionId);
        return R.ok();
    }

    @Operation(summary = "处理工具授权")
    @PostMapping("/{sessionId}/approvals/{approvalId}")
    public R<Void> resolveToolApproval(@PathVariable String sessionId, @PathVariable String approvalId, @Valid @RequestBody ToolApprovalReq req) {
        toolApprovalService.resolve(sessionId, approvalId, req.decision());
        return R.ok();
    }

    @Operation(summary = "聊天")
    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<@NonNull ServerSentEvent<@NonNull SessionEvent>> chat(@Valid @RequestBody ChatReq req) {
        Sinks.One<Void> streamEnded = Sinks.one();
        Flux<ServerSentEvent<SessionEvent>> sessionEvents = turnService.turn(req.sessionId(), req.workspacePath(), sessionTurn -> turnService.chatStream(sessionTurn, req.userMessage(), LLMUtil.buildChatReq(req.modelName(), req.reasoningEffort())))
                .map(e -> ServerSentEvent.<SessionEvent>builder().event(SSEEvent.SESSION.getCode()).data(e).build())
                .doFinally(_ -> streamEnded.tryEmitEmpty());
        Flux<ServerSentEvent<SessionEvent>> heartbeatEvents = Flux.interval(SSE_HEARTBEAT_INTERVAL)
                .map(_ -> ServerSentEvent.<SessionEvent>builder().comment("keep-alive").build())
                .takeUntilOther(streamEnded.asMono());

        return Flux.merge(sessionEvents, heartbeatEvents);
    }
}
