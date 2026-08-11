import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type SessionRuntimeStatus =
  | "idle"
  | "running"
  | "error"
  | "completed"
  | "cancelled";

export type SessionRuntime = {
  status: SessionRuntimeStatus;
  turnId: string | null;
  abortController: AbortController | null;
  errorMessage: string;
  unreadCount: number;
  lastEventAt: string | null;
};

type SessionRuntimeState = {
  sessions: Record<string, SessionRuntime>;
  ensure: (sessionId: string) => void;
  start: (sessionId: string, controller: AbortController) => void;
  setTurn: (sessionId: string, turnId: string | null) => void;
  setStatus: (sessionId: string, status: SessionRuntimeStatus, errorMessage?: string) => void;
  markEvent: (sessionId: string, createdAt?: string) => void;
  markRead: (sessionId: string) => void;
  stop: (sessionId: string) => void;
  reset: (sessionId: string) => void;
  move: (fromSessionId: string, toSessionId: string) => void;
};

const EMPTY_RUNTIME: SessionRuntime = {
  status: "idle",
  turnId: null,
  abortController: null,
  errorMessage: "",
  unreadCount: 0,
  lastEventAt: null,
};

const lastPulseAt = new Map<string, number>();
const SESSION_ITEM_SELECTOR = '[data-session-running="true"]';
const PULSE_MIN_INTERVAL_MS = 400;

function triggerSessionPulse(sessionId: string) {
  const now = performance.now();
  const last = lastPulseAt.get(sessionId) ?? 0;
  if (now - last < PULSE_MIN_INTERVAL_MS) return;
  lastPulseAt.set(sessionId, now);
  document
    .querySelectorAll<HTMLElement>(SESSION_ITEM_SELECTOR)
    .forEach((item) => {
      if (item.dataset.sessionId === sessionId) {
        item.dataset.sessionPulseAt = String(now);
      }
    });
}

export const sessionRuntimeStore = createStore<SessionRuntimeState>()((set) => ({
  sessions: {},
  ensure: (sessionId) => {
    if (!sessionId) return;
    set((state) =>
      state.sessions[sessionId]
        ? state
        : { sessions: { ...state.sessions, [sessionId]: { ...EMPTY_RUNTIME } } },
    );
  },
  start: (sessionId, controller) => {
    if (!sessionId) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? EMPTY_RUNTIME),
          status: "running",
          turnId: null,
          abortController: controller,
          errorMessage: "",
          lastEventAt: new Date().toISOString(),
        },
      },
    }));
  },
  setTurn: (sessionId, turnId) => {
    if (!sessionId) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...(state.sessions[sessionId] ?? EMPTY_RUNTIME), turnId },
      },
    }));
  },
  setStatus: (sessionId, status, errorMessage = "") => {
    if (!sessionId) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? EMPTY_RUNTIME),
          status,
          errorMessage,
          abortController:
            status === "running"
              ? state.sessions[sessionId]?.abortController ?? null
              : null,
          turnId: status === "running" ? state.sessions[sessionId]?.turnId ?? null : null,
        },
      },
    }));
  },
  markEvent: (sessionId, createdAt) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId] ?? EMPTY_RUNTIME;
      if (current.status === "running") {
        triggerSessionPulse(sessionId);
      }
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...current,
            lastEventAt: createdAt ?? new Date().toISOString(),
            unreadCount: current.unreadCount + 1,
          },
        },
      };
    });
  },
  markRead: (sessionId) => {
    if (!sessionId) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: { ...(state.sessions[sessionId] ?? EMPTY_RUNTIME), unreadCount: 0 },
      },
    }));
  },
  stop: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId] ?? EMPTY_RUNTIME;
      current.abortController?.abort();
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...current, status: "cancelled", abortController: null, turnId: null },
        },
      };
    });
  },
  reset: (sessionId) => {
    if (!sessionId) return;
    set((state) => ({
      sessions: { ...state.sessions, [sessionId]: { ...EMPTY_RUNTIME } },
    }));
  },
  move: (fromSessionId, toSessionId) => {
    if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return;
    set((state) => {
      const source = state.sessions[fromSessionId];
      if (!source) return state;
      return {
        sessions: {
          ...state.sessions,
          [toSessionId]: source,
          [fromSessionId]: { ...EMPTY_RUNTIME },
        },
      };
    });
  },
}));

export const useSessionRuntimeStore = <T>(selector: (state: SessionRuntimeState) => T) =>
  useStore(sessionRuntimeStore, selector);

export const getSessionRuntime = (sessionId: string) =>
  sessionRuntimeStore.getState().sessions[sessionId] ?? EMPTY_RUNTIME;
