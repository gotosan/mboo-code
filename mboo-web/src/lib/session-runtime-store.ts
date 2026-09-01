import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type SessionRuntimeStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "error"
  | "completed"
  | "cancelled";

export type SessionStreamKind = "chat" | "compression";

export type SessionRuntime = {
  status: SessionRuntimeStatus;
  turnId: string | null;
  abortController: AbortController | null;
  streamKind: SessionStreamKind | null;
  errorMessage: string;
  unreadCount: number;
  lastEventAt: string | null;
};

type SessionRuntimeState = {
  sessions: Record<string, SessionRuntime>;
  ensure: (sessionId: string) => void;
  start: (sessionId: string, controller: AbortController, streamKind: SessionStreamKind) => void;
  beginCancel: (sessionId: string, controller: AbortController) => void;
  setCancelError: (sessionId: string, controller: AbortController, errorMessage: string) => void;
  finish: (sessionId: string, controller: AbortController, status?: SessionRuntimeStatus, errorMessage?: string) => void;
  setTurn: (sessionId: string, turnId: string | null) => void;
  setStatus: (sessionId: string, status: SessionRuntimeStatus, errorMessage?: string) => void;
  markEvent: (sessionId: string, createdAt?: string) => void;
  markRead: (sessionId: string) => void;
  reset: (sessionId: string) => void;
  move: (fromSessionId: string, toSessionId: string) => void;
};

const EMPTY_RUNTIME: SessionRuntime = {
  status: "idle",
  turnId: null,
  abortController: null,
  streamKind: null,
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
  start: (sessionId, controller, streamKind) => {
    if (!sessionId) return;
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...(state.sessions[sessionId] ?? EMPTY_RUNTIME),
          status: "running",
          turnId: null,
          abortController: controller,
          streamKind,
          errorMessage: "",
          lastEventAt: new Date().toISOString(),
        },
      },
    }));
  },
  beginCancel: (sessionId, controller) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current || current.abortController !== controller || (current.status !== "running" && current.status !== "cancelling")) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...current, status: "cancelling", errorMessage: "" } } };
    });
  },
  setCancelError: (sessionId, controller, errorMessage) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current || current.abortController !== controller) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...current, status: "cancelling", errorMessage } } };
    });
  },
  finish: (sessionId, controller, status = "idle", errorMessage = "") => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId];
      if (!current || current.abortController !== controller) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...current, status, turnId: null, abortController: null, streamKind: null, errorMessage },
        },
      };
    });
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
            status === "running" || status === "cancelling"
              ? state.sessions[sessionId]?.abortController ?? null
              : null,
          turnId: status === "running" || status === "cancelling" ? state.sessions[sessionId]?.turnId ?? null : null,
          streamKind: status === "running" || status === "cancelling" ? state.sessions[sessionId]?.streamKind ?? null : null,
        },
      },
    }));
  },
  markEvent: (sessionId, createdAt) => {
    if (!sessionId) return;
    set((state) => {
      const current = state.sessions[sessionId] ?? EMPTY_RUNTIME;
      if (current.status === "running" || current.status === "cancelling") {
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
      const sessions = { ...state.sessions, [toSessionId]: source };
      delete sessions[fromSessionId];
      return { sessions };
    });
    lastPulseAt.delete(fromSessionId);
  },
}));

export const useSessionRuntimeStore = <T>(selector: (state: SessionRuntimeState) => T) =>
  useStore(sessionRuntimeStore, selector);

export const getSessionRuntime = (sessionId: string) =>
  sessionRuntimeStore.getState().sessions[sessionId] ?? EMPTY_RUNTIME;
