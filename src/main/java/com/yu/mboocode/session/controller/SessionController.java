package com.yu.mboocode.session.controller;

import com.yu.mboocode.common.dto.R;
import com.yu.mboocode.common.enums.SSEEvent;
import com.yu.mboocode.llm.LLMUtil;
import com.yu.mboocode.session.dto.ChatReq;
import com.yu.mboocode.session.dto.SessionUpdateReq;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.session.service.SessionService;
import com.yu.mboocode.session.service.TurnService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.jspecify.annotations.NonNull;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

import java.util.List;

@Tag(name = "会话")
@RestController
@RequestMapping("/session")
public class SessionController {
    @Resource
    private TurnService turnService;
    @Resource
    private SessionService sessionService;

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
        sessionService.deleteSession(sessionId);
        return R.ok();
    }

    @Operation(summary = "聊天")
    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<@NonNull ServerSentEvent<@NonNull SessionEvent>> chat(@Valid @RequestBody ChatReq req) {
        return turnService.turn(req.sessionId(), sessionTurn -> turnService.chatStream(sessionTurn, req.userMessage(), LLMUtil.buildChatReq(req.modelName(), req.reasoningEffort())))
                .map(e -> ServerSentEvent.<SessionEvent>builder().event(SSEEvent.SESSION.getCode()).data(e).build());
    }
}
