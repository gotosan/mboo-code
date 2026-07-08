package com.yu.mboocode.session.service;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import cn.hutool.extra.spring.SpringUtil;
import com.alibaba.fastjson2.JSON;
import com.yu.mboocode.common.exception.ServiceException;
import com.yu.mboocode.llm.AiCodeService;
import com.yu.mboocode.session.enums.SessionEventSource;
import com.yu.mboocode.session.enums.SessionEventType;
import com.yu.mboocode.session.mapper.SessionEventStore;
import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.SessionTurn;
import com.yu.mboocode.session.model.Sessions;
import com.yu.mboocode.session.payload.AssistantMessageDeltaPayload;
import com.yu.mboocode.session.payload.AssistantMessagePayload;
import com.yu.mboocode.session.payload.SessionEventPayload;
import com.yu.mboocode.session.payload.ToolCallCompletedPayload;
import com.yu.mboocode.session.payload.ToolCallFailedPayload;
import com.yu.mboocode.session.payload.ToolCallStartedPayload;
import com.yu.mboocode.session.payload.TurnCancelledPayload;
import com.yu.mboocode.session.payload.TurnCompletedPayload;
import com.yu.mboocode.session.payload.TurnFailedPayload;
import com.yu.mboocode.session.payload.TurnStartedPayload;
import com.yu.mboocode.session.payload.UserMessagePayload;
import com.yu.mboocode.util.DateTimeUtil;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.model.chat.request.ChatRequestParameters;
import dev.langchain4j.service.tool.ToolExecution;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.tuple.Triple;
import org.jspecify.annotations.NonNull;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import reactor.core.publisher.Flux;
import reactor.core.publisher.FluxSink;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@Slf4j
public class TurnService {
    @Resource
    private AiCodeService aiCodeService;
    @Resource
    private SessionEventStore sessionEventStore;
    @Resource
    private SessionService sessionService;

    public Flux<@NonNull SessionEvent> chatTurn(String sessionId, String userMessage, ChatRequestParameters params) {
        // 轮次开始和用户消息
        Triple<SessionTurn, SessionEvent, SessionEvent> triple = SpringUtil.getBean(this.getClass()).startTurn(sessionId, userMessage);
        // 模型消息、工具调用等
        Flux<@NonNull SessionEvent> chatStream = chatStream(triple.getLeft(), userMessage, params);

        return Flux.fromIterable(List.of(triple.getMiddle(), triple.getRight())).concatWith(chatStream);
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
                    TurnStartedPayload.builder()
                            .trigger("user")
                            .userMessageId(userMessageId)
                            .build()
            );
            userMessageEvent = sessionEventStore.appendSession(
                    session.getTranscriptUri(),
                    session.getId(),
                    turnId,
                    SessionEventType.USER_MESSAGE,
                    SessionEventSource.USER,
                    UserMessagePayload.builder()
                            .messageId(userMessageId)
                            .text(userMessage)
                            .build()
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

    private Flux<@NonNull SessionEvent> chatStream(
            SessionTurn turn,
            String userMessage,
            ChatRequestParameters params
    ) {
        AtomicBoolean turnClosed = new AtomicBoolean(false);
        StringBuffer finalText = new StringBuffer();
        long startNano = System.nanoTime();

        return Flux.create(sink -> {
            sink.onCancel(() -> {
                if (turnClosed.compareAndSet(false, true)) {
                    SpringUtil.getBean(this.getClass()).cancelTurn(turn, "client_disconnected", finalText.toString(), DateTimeUtil.durationMs(startNano));
                }
            });

            try {
                aiCodeService.chatStream(userMessage, params)
                        .onPartialResponse(chunk -> { // 文本流
                            if (isTurnClosed(turnClosed, sink)) {
                                return;
                            }
                            finalText.append(chunk);
                            emitEvent(sink, SessionEvent.builder()
                                    .eventId(IdUtil.getSnowflakeNextIdStr())
                                    .sessionId(turn.sessionId())
                                    .turnId(turn.turnId())
                                    .type(SessionEventType.ASSISTANT_MESSAGE_DELTA)
                                    .source(SessionEventSource.ASSISTANT)
                                    .createdAt(DateTimeUtil.now())
                                    .payload(AssistantMessageDeltaPayload.builder()
                                            .messageId(turn.assistantMessageId())
                                            .text(chunk)
                                            .build())
                                    .meta(Map.of("runtimeOnly", true))
                                    .build());
                        })
                        .beforeToolExecution(beforeToolExecution -> { // 工具执行前
                            if (isTurnClosed(turnClosed, sink)) {
                                return;
                            }
                            ToolExecutionRequest request = beforeToolExecution.request();
                            String toolCallId = request.id();

                            emitEvent(sink, sessionEventStore.appendSession(
                                    turn.transcriptUri(),
                                    turn.sessionId(),
                                    turn.turnId(),
                                    SessionEventType.TOOL_CALL_STARTED,
                                    SessionEventSource.ASSISTANT,
                                    ToolCallStartedPayload.builder()
                                            .messageId(turn.assistantMessageId())
                                            .toolCallId(toolCallId)
                                            .toolName(request.name())
                                            .arguments(request.arguments())
                                            .build()));
                        })
                        .onToolExecuted(toolExecution -> { //工具执行后
                            if (isTurnClosed(turnClosed, sink)) {
                                return;
                            }
                            ToolExecutionRequest request = toolExecution.request();
                            String toolCallId = request.id();

                            boolean failed = toolExecution.hasFailed();
                            String resultPreview = toolResultPreview(toolExecution);
                            SessionEventType eventType;
                            SessionEventPayload payload;
                            if (failed) {
                                eventType = SessionEventType.TOOL_CALL_FAILED;
                                payload = ToolCallFailedPayload.builder()
                                        .messageId(turn.assistantMessageId())
                                        .toolCallId(toolCallId)
                                        .toolName(request.name())
                                        .arguments(request.arguments())
                                        .resultPreview(resultPreview)
                                        .errorCode("TOOL_EXECUTION_FAILED")
                                        .errorMessage(resultPreview)
                                        .durationMs(toolExecution.duration().toMillis())
                                        .build();
                            } else {
                                eventType = SessionEventType.TOOL_CALL_COMPLETED;
                                payload = ToolCallCompletedPayload.builder()
                                        .messageId(turn.assistantMessageId())
                                        .toolCallId(toolCallId)
                                        .toolName(request.name())
                                        .arguments(request.arguments())
                                        .resultPreview(resultPreview)
                                        .durationMs(toolExecution.duration().toMillis())
                                        .build();
                            }

                            emitEvent(sink, sessionEventStore.appendSession(
                                    turn.transcriptUri(),
                                    turn.sessionId(),
                                    turn.turnId(),
                                    eventType,
                                    SessionEventSource.SYSTEM,
                                    payload
                            ));
                        })
                        .onCompleteResponse(_ -> { // 流完成时
                            if (turnClosed.compareAndSet(false, true)) {
                                SpringUtil.getBean(this.getClass()).completeTurn(turn, finalText.toString(), DateTimeUtil.durationMs(startNano)).forEach(event -> emitEvent(sink, event));
                                if (!sink.isCancelled()) {
                                    sink.complete();
                                }
                            }
                        })
                        // 出错时
                        .onError(error -> failSinkTurn(sink, turn, turnClosed, error, finalText.toString(), DateTimeUtil.durationMs(startNano)))
                        .start();
            } catch (Throwable error) {
                failSinkTurn(sink, turn, turnClosed, error, finalText.toString(), DateTimeUtil.durationMs(startNano));
            }
        }, FluxSink.OverflowStrategy.BUFFER);
    }

    private boolean isTurnClosed(AtomicBoolean turnClosed, FluxSink<@NonNull SessionEvent> sink) {
        return turnClosed.get() || sink.isCancelled();
    }

    private void failSinkTurn(FluxSink<@NonNull SessionEvent> sink, SessionTurn turn, AtomicBoolean turnClosed, Throwable error, String partialText, long durationMs) {
        if (turnClosed.compareAndSet(false, true)) {
            SpringUtil.getBean(this.getClass()).failTurn(turn, error, partialText, durationMs).forEach(event -> emitEvent(sink, event));
            if (!sink.isCancelled()) {
                sink.complete();
            }
        }
    }

    private void emitEvent(FluxSink<@NonNull SessionEvent> sink, SessionEvent event) {
        if (!sink.isCancelled()) {
            sink.next(event);
        }
    }

    private String toolResultPreview(ToolExecution toolExecution) {
        //todo 返回结构处理
        try {
            Object resultObject = toolExecution.resultObject();
            if (resultObject instanceof CharSequence text) {
                return truncateToolText(text.toString());
            }
            if (resultObject != null) {
                return truncateToolText(JSON.toJSONString(resultObject));
            }
        } catch (RuntimeException ignored) {
            // 部分工具只提供文本结果，继续尝试读取 result()。
        }

        try {
            return truncateToolText(toolExecution.result());
        } catch (RuntimeException e) {
            return "";
        }
    }

    private String truncateToolText(String text) {
        if (text == null) {
            return "";
        }
        int maxLength = 2000;
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength) + "\n...（结果已截断）";
    }

    @Transactional
    public List<SessionEvent> completeTurn(SessionTurn turn, String finalText, long durationMs) {
        SessionEvent assistantMessageEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.ASSISTANT_MESSAGE,
                SessionEventSource.ASSISTANT,
                AssistantMessagePayload.builder()
                        .messageId(turn.assistantMessageId())
                        .state("completed")
                        .text(finalText)
                        .finishReason("stop")
                        .durationMs(durationMs)
                        .build()
        );
        SessionEvent turnCompletedEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_COMPLETED,
                SessionEventSource.SYSTEM,
                TurnCompletedPayload.builder()
                        .durationMs(durationMs)
                        .build()
        );
        sessionService.clearActiveTurn(turn.sessionId());
        return List.of(assistantMessageEvent, turnCompletedEvent);
    }

    @Transactional
    public List<SessionEvent> failTurn(SessionTurn turn, Throwable error, String partialText, long durationMs) {
        //todo 后续根据错误类型返回对应报错
        log.error("failTurn turn:{}", turn, error);
        String errorMessage = error.getMessage() == null ? "" : error.getMessage();
        SessionEvent assistantMessageEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.ASSISTANT_MESSAGE,
                SessionEventSource.ASSISTANT,
                AssistantMessagePayload.builder()
                        .messageId(turn.assistantMessageId())
                        .state("interrupted")
                        .text(partialText)
                        .reason("model_error")
                        .errorMessage(errorMessage)
                        .durationMs(durationMs)
                        .build()
        );
        SessionEvent turnFailedEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_FAILED,
                SessionEventSource.SYSTEM,
                TurnFailedPayload.builder()
                        .errorCode(error.getClass().getSimpleName())
                        .errorMessage(errorMessage)
                        .durationMs(durationMs)
                        .build()
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
                AssistantMessagePayload.builder()
                        .messageId(turn.assistantMessageId())
                        .state("interrupted")
                        .text(partialText)
                        .reason(reason)
                        .durationMs(durationMs)
                        .build()
        );
        SessionEvent turnCancelledEvent = sessionEventStore.appendSession(
                turn.transcriptUri(),
                turn.sessionId(),
                turn.turnId(),
                SessionEventType.TURN_CANCELLED,
                SessionEventSource.SYSTEM,
                TurnCancelledPayload.builder()
                        .reason(reason)
                        .durationMs(durationMs)
                        .build()
        );
        sessionService.clearActiveTurn(turn.sessionId());
        return List.of(assistantMessageEvent, turnCancelledEvent);
    }
}
