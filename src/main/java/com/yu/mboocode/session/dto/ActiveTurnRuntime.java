package com.yu.mboocode.session.dto;

import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.SessionTurn;
import dev.langchain4j.model.chat.response.StreamingHandle;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.NonNull;
import reactor.core.publisher.FluxSink;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@Schema(description = "运行中 turn 的临时上下文")
public record ActiveTurnRuntime(SessionTurn turn,
                                AtomicBoolean turnClosed,
                                StringBuffer finalText,
                                long startNano,
                                AtomicReference<StreamingHandle> streamingHandle,
                                FluxSink<@NonNull SessionEvent> sink) {
}
