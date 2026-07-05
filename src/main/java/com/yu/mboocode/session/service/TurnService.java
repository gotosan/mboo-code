package com.yu.mboocode.session.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.alibaba.fastjson2.JSONObject;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.AiCodeService;
import com.yu.mboocode.session.enums.SessionEventSource;
import com.yu.mboocode.session.enums.SessionEventType;
import com.yu.mboocode.session.mapper.SessionEventStore;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.SessionTurn;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.util.DateTimeUtil;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import jakarta.annotation.Resource;
import org.apache.commons.lang3.tuple.Triple;
import org.jspecify.annotations.NonNull;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class TurnService {
    @Resource
    private AiCodeService aiCodeService;
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SessionService sessionService;

    public Flux<@NonNull SessionEvent> chatTurn(String sessionId, String userMessage, ChatRequestParameters params) {
        Triple<SessionTurn, SessionEvent, SessionEvent> triple = startTurn(sessionId, userMessage);

        SessionTurn turn = triple.getLeft();
        AtomicBoolean turnClosed = new AtomicBoolean(false);
        long startNano = System.nanoTime();
        StringBuilder finalText = new StringBuilder();

        // 轮次开始和用户消息
        Flux<@NonNull SessionEvent> turnStartedEvents = Flux.fromIterable(List.of(triple.getMiddle(), triple.getRight()));

        // 增量消息
        Flux<@NonNull SessionEvent> assistantTextEvents = aiCodeService.chatStream(userMessage, params)
                .doOnNext(finalText::append)
                .map(chunk ->
                        SessionEvent.builder()
                                .eventId(IdUtil.getSnowflakeNextIdStr())
                                .sessionId(turn.sessionId())
                                .turnId(turn.turnId())
                                .type(SessionEventType.ASSISTANT_MESSAGE_DELTA)
                                .source(SessionEventSource.ASSISTANT)
                                .createdAt(DateTimeUtil.now())
                                .payload(payload(
                                        "messageId", turn.assistantMessageId(),
                                        "text", chunk
                                ))
                                .meta(Map.of("runtimeOnly", true))
                                .build()
                )
                .concatWith(Flux.defer(() -> {
                    if (turnClosed.compareAndSet(false, true)) {
                        return Flux.fromIterable(completeTurn(turn, finalText.toString(), DateTimeUtil.durationMs(startNano)));
                    }
                    return Flux.empty();
                }))
                .onErrorResume(error -> {
                    if (turnClosed.compareAndSet(false, true)) {
                        return Flux.fromIterable(failTurn(turn, error, finalText.toString(), DateTimeUtil.durationMs(startNano)));
                    }
                    return Flux.empty();
                });

        return turnStartedEvents.concatWith(assistantTextEvents)
                .doOnCancel(() -> {
                    if (turnClosed.compareAndSet(false, true)) {
                        cancelTurn(turn, "client_disconnected", finalText.toString(), DateTimeUtil.durationMs(startNano));
                    }
                });
    }

    @Transactional
    public Triple<SessionTurn, SessionEvent, SessionEvent> startTurn(String sessionId, String userMessage) {
        Sessions session = sessionService.getActiveOrCreateSession(sessionId, userMessage);
        if (StrUtil.isNotBlank(session.getActiveTurnId())) {
            throw new ServiceException("当前会话已有运行中的 turn: " + session.getActiveTurnId());
        }

        String turnId = IdUtil.getSnowflakeNextIdStr();
        String userMessageId = IdUtil.getSnowflakeNextIdStr();
        String assistantMessageId = IdUtil.getSnowflakeNextIdStr();

        if (!sessionService.updateActiveTurn(session.getId(), turnId)) {
            throw new ServiceException("当前会话已有运行中的 turn");
        }

        SessionEvent turnStartedEvent;
        SessionEvent userMessageEvent;
        try {
            turnStartedEvent = sessionEventStore.appendSession(
                    session.getTranscriptUri(),
                    session.getId(),
                    turnId,
                    SessionEventType.TURN_STARTED,
                    SessionEventSource.SYSTEM,
                    sessionEventStore.payload(
                            "trigger", "user",
                            "userMessageId", userMessageId
                    )
            );
            userMessageEvent = sessionEventStore.appendSession(
                    session.getTranscriptUri(),
                    session.getId(),
                    turnId,
                    SessionEventType.USER_MESSAGE,
                    SessionEventSource.USER,
                    sessionEventStore.payload(
                            "messageId", userMessageId,
                            "text", userMessage,
                            "attachments", List.of()
                    )
            );
        } catch (RuntimeException e) {
            sessionService.clearActiveTurn(session.getId()); //错误时清理当前活跃轮次
            throw e;
        }

        return Triple.of(new SessionTurn(
                session.getId(),
                session.getTranscriptUri(),
                turnId,
                userMessageId,
                assistantMessageId
        ), turnStartedEvent, userMessageEvent);
    }

    private JSONObject payload(Object... keyValues) {
        JSONObject payload = new JSONObject();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            payload.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return payload;
    }

    @Transactional
    public List<SessionEvent> completeTurn(SessionTurn turn, String finalText, long durationMs) {
        SessionEvent assistantMessageEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.ASSISTANT_MESSAGE,
                SessionEventSource.ASSISTANT,
                sessionEventStore.payload(
                        "messageId", turn.assistantMessageId(),
                        "state", "completed",
                        "text", finalText,
                        "finishReason", "stop",
                        "durationMs", durationMs
                )
        );
        SessionEvent turnCompletedEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_COMPLETED,
                SessionEventSource.SYSTEM,
                sessionEventStore.payload("durationMs", durationMs)
        );
        sessionService.clearActiveTurn(turn.sessionId());
        return List.of(assistantMessageEvent, turnCompletedEvent);
    }

    @Transactional
    public List<SessionEvent> failTurn(SessionTurn turn, Throwable error, String partialText, long durationMs) {
        String errorMessage = error.getMessage() == null ? "" : error.getMessage();
        SessionEvent assistantMessageEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.ASSISTANT_MESSAGE,
                SessionEventSource.ASSISTANT,
                sessionEventStore.payload(
                        "messageId", turn.assistantMessageId(),
                        "state", "interrupted",
                        "text", partialText,
                        "reason", "model_error",
                        "errorMessage", errorMessage,
                        "durationMs", durationMs
                )
        );
        SessionEvent turnFailedEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_FAILED,
                SessionEventSource.SYSTEM,
                sessionEventStore.payload(
                        "errorCode", error.getClass().getSimpleName(),
                        "errorMessage", errorMessage,
                        "durationMs", durationMs
                )
        );
        sessionService.clearActiveTurn(turn.sessionId());
        return List.of(assistantMessageEvent, turnFailedEvent);
    }

    @Transactional
    public List<SessionEvent> cancelTurn(SessionTurn turn, String reason, String partialText, long durationMs) {
        SessionEvent assistantMessageEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.ASSISTANT_MESSAGE,
                SessionEventSource.ASSISTANT,
                sessionEventStore.payload(
                        "messageId", turn.assistantMessageId(),
                        "state", "interrupted",
                        "text", partialText,
                        "reason", reason,
                        "errorMessage", null,
                        "durationMs", durationMs
                )
        );
        SessionEvent turnCancelledEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_CANCELLED,
                SessionEventSource.SYSTEM,
                sessionEventStore.payload(
                        "reason", reason,
                        "durationMs", durationMs
                )
        );
        sessionService.clearActiveTurn(turn.sessionId());
        return List.of(assistantMessageEvent, turnCancelledEvent);
    }
}
