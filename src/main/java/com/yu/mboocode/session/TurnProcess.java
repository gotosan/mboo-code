package com.yu.mboocode.session;

import com.yu.mboocode.session.model.SessionEvent;
import com.yu.mboocode.session.model.SessionTurn;
import org.jspecify.annotations.NonNull;
import reactor.core.publisher.Flux;

@FunctionalInterface
public interface TurnProcess {
    Flux<@NonNull SessionEvent> process(SessionTurn sessionTurn);
}
