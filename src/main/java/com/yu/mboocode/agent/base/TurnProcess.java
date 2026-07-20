package com.yu.mboocode.agent.base;

import com.yu.mboocode.agent.model.SessionEvent;
import com.yu.mboocode.agent.model.SessionTurn;
import org.jspecify.annotations.NonNull;
import reactor.core.publisher.Flux;

@FunctionalInterface
public interface TurnProcess {
    Flux<@NonNull SessionEvent> process(SessionTurn sessionTurn);
}
