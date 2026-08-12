package com.yu.mboocode.agent.tool.network;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class NetworkConcurrencyLimiter {
    private final Semaphore global = new Semaphore(4, true);
    private final Map<String, Semaphore> sessions = new ConcurrentHashMap<>();

    public Permit acquire(String sessionId, RunningNetworkCall call, long deadlineNanos) {
        Semaphore session = sessions.computeIfAbsent(sessionId, ignored -> new Semaphore(1, true));
        boolean sessionAcquired = false;
        try {
            sessionAcquired = acquire(session, call, deadlineNanos);
            if (!sessionAcquired) throw timeoutOrCancelled(call);
            if (!acquire(global, call, deadlineNanos)) throw timeoutOrCancelled(call);
            return new Permit(session, global);
        } catch (InterruptedException e) {
            if (sessionAcquired) session.release();
            Thread.currentThread().interrupt();
            throw cancelled();
        } catch (RuntimeException e) {
            if (sessionAcquired) session.release();
            throw e;
        }
    }

    private boolean acquire(Semaphore semaphore, RunningNetworkCall call, long deadlineNanos) throws InterruptedException {
        while (!call.cancelled()) {
            long remaining = deadlineNanos - System.nanoTime();
            if (remaining <= 0) return false;
            if (semaphore.tryAcquire(Math.min(remaining, TimeUnit.MILLISECONDS.toNanos(100)), TimeUnit.NANOSECONDS)) return true;
        }
        return false;
    }

    private NetworkToolException timeoutOrCancelled(RunningNetworkCall call) {
        return call.cancelled() ? cancelled() : new NetworkToolException(NetworkToolErrorCode.NETWORK_TIMEOUT, "网络调用在等待执行许可时超时");
    }

    private NetworkToolException cancelled() {
        return new NetworkToolException(NetworkToolErrorCode.NETWORK_CANCELLED, "网络调用已取消");
    }

    public static final class Permit implements AutoCloseable {
        private final Semaphore session;
        private final Semaphore global;
        private final AtomicBoolean closed = new AtomicBoolean();

        private Permit(Semaphore session, Semaphore global) {
            this.session = session;
            this.global = global;
        }

        @Override
        public void close() {
            if (!closed.compareAndSet(false, true)) return;
            global.release();
            session.release();
        }
    }
}
