import { create } from "zustand";
import type { SessionEvent, ContextUsageSnapshot } from "@/lib/session-types";

export type SubagentRun = {
  runId: string;
  agentId: string;
  parentSessionId: string;
  parentTurnId: string;
  parentMessageId: string;
  parentToolCallId: string;
  childTurnId?: string;
  role: "explorer" | "worker";
  mode: "foreground" | "background";
  modelId: string;
  status: "STARTING" | "RUNNING" | "WAITING_APPROVAL" | "FINALIZING" | "CANCELLING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
  version: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  resultId?: string;
  finalText?: string;
  errorCode?: string;
  errorMessage?: string;
  usage?: string;
};

type AgentState = {
  runs: Record<string, SubagentRun>;
  events: Record<string, SessionEvent[]>;
  closedApprovals: Record<string, boolean>;
  ingest: (event: SessionEvent) => void;
  update: (run: SubagentRun) => void;
};

export const isSubagentTerminal = (run: SubagentRun) => ["SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status);
export const useSubagentStore = create<AgentState>((set, get) => ({
  runs: {}, events: {}, closedApprovals: {},
  update: (run) => set((state) => (state.runs[run.runId]?.version ?? -1) >= run.version ? state : { runs: { ...state.runs, [run.runId]: run } }),
  ingest: (event) => {
    if (event.type === "SUBAGENT_RUN_UPDATED") get().update(event.payload.run);
    if (event.type === "SUBAGENT_EVENT") {
      const { agentId, childEvent } = event.payload;
      set((state) => {
        const events = state.events[agentId] ?? [];
        if (events.some((item) => item.eventId === childEvent.eventId)) return state;
        return { events: { ...state.events, [agentId]: [...events, childEvent] } };
      });
    }
    if (event.type === "SUBAGENT_APPROVAL_UPDATED" && !event.payload.pending) {
      set((state) => ({ closedApprovals: { ...state.closedApprovals, [event.payload.approvalId]: true } }));
    }
  },
}));

export async function agentRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.msg || body.message || "子任务请求失败");
  return body.data as T;
}

export function parseAgentUsage(run: SubagentRun): ContextUsageSnapshot | null {
  try { return run.usage ? JSON.parse(run.usage) : null; } catch { return null; }
}
