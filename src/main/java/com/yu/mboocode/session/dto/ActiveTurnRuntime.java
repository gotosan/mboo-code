package com.yu.mboocode.session.dto;

import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.SessionTurn;
import lombok.NonNull;
import reactor.core.publisher.FluxSink;

import java.util.concurrent.atomic.AtomicBoolean;

public record ActiveTurnRuntime(SessionTurn turn,
                                AtomicBoolean turnClosed,
                                StringBuffer finalText,
                                long startNano,
                                FluxSink<@NonNull SessionEvent> sink) {
}
