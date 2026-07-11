package com.yu.mboocode.session.controller;

import cn.hutool.core.util.IdUtil;
import com.yu.mboocode.common.dto.R;
import com.yu.mboocode.common.enums.SSEEvent;
import com.yu.mboocode.llm.LLMUtil;
import com.yu.mboocode.session.dto.ChatReq;
import com.yu.mboocode.session.dto.SessionUpdateReq;
import com.yu.mboocode.session.enums.SessionEventSource;
import com.yu.mboocode.session.enums.SessionEventType;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.session.payload.TurnFailedPayload;
import com.yu.mboocode.session.service.SessionService;
import com.yu.mboocode.session.service.TurnService;
import com.yu.mboocode.util.DateTimeUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
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

import java.util.Collections;
import java.util.List;

@Tag(name = "会话")
@RestController
@RequestMapping("/session")
@Slf4j
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
        turnService.cancelActiveTurn(sessionId, "session_archived");
        return R.ok(sessionService.archiveSession(sessionId));
    }

    @Operation(summary = "永久删除会话")
    @DeleteMapping("/{sessionId}")
    public R<Void> delete(@PathVariable String sessionId) {
        turnService.cancelActiveTurn(sessionId, "session_deleted");
        sessionService.deleteSession(sessionId);
        return R.ok();
    }

    @Operation(summary = "取消当前运行中的会话轮次")
    @PostMapping("/{sessionId}/cancel")
    public R<Boolean> cancel(@PathVariable String sessionId) {
        return R.ok(turnService.cancelActiveTurn(sessionId, "user_cancelled"));
    }

    @Operation(summary = "聊天")
    @PostMapping(value = "/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<@NonNull ServerSentEvent<@NonNull SessionEvent>> chat(@Valid @RequestBody ChatReq req) {
        return Flux.defer(() ->
                turnService.chatTurn(req.sessionId(), req.userMessage(), LLMUtil.buildChatReq(req.modelName(), req.reasoningEffort()))
                        .map(e -> ServerSentEvent.<SessionEvent>builder().event(SSEEvent.SESSION.getCode()).data(e).build())
        ).onErrorResume(error -> {
            log.error("会话请求失败", error);
            return Flux.just(ServerSentEvent.<SessionEvent>builder()
                    .event(SSEEvent.SESSION.getCode())
                    .data(SessionEvent.builder()
                            .eventId(IdUtil.getSnowflakeNextIdStr())
                            .sessionId(req.sessionId())
                            .type(SessionEventType.TURN_FAILED)
                            .source(SessionEventSource.SYSTEM)
                            .createdAt(DateTimeUtil.now())
                            .payload(TurnFailedPayload.builder()
                                    .errorCode(error.getClass().getSimpleName())
                                    .errorMessage(error.getMessage() == null ? "会话请求失败" : error.getMessage())
                                    .build())
                            .meta(Collections.emptyMap())
                            .build())
                    .build());
        });
    }
}
