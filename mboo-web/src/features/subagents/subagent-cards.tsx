"use client";

import { useEffect, useMemo, useState } from "react";
import AssistantMarkdown from "@/components/assistant-markdown";
import { ToolApprovalCard } from "@/features/tools/tool-approval-card";
import { ToolTrace } from "@/features/tools/tool-trace";
import type { ToolCallView } from "@/features/agent-run/message-model";
import type { SessionEvent, ToolApprovalDecision, ToolResultDetail, ContextUsageSnapshot } from "@/lib/session-types";
import { useSubagentStore, agentRequest, isSubagentTerminal, parseAgentUsage, type SubagentRun } from "./subagent-store";

const STATUS: Record<SubagentRun["status"], string> = { STARTING: "启动中", RUNNING: "执行中", WAITING_APPROVAL: "等待授权", FINALIZING: "清理中", CANCELLING: "取消中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消", INTERRUPTED: "已中断" };
const EMPTY_EVENTS: SessionEvent[] = [];

export function SubagentCards({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const runs = useSubagentStore((state) => state.runs);
  const selected = Object.values(runs).filter((run) => run.parentSessionId === sessionId && run.parentMessageId === messageId);
  return <div className="space-y-2">{selected.map((run) => <SubagentCard key={run.runId} run={run} />)}</div>;
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<SessionEvent[]>([]);
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const live = useSubagentStore((state) => state.events[run.agentId] ?? EMPTY_EVENTS);
  const closed = useSubagentStore((state) => state.closedApprovals);
  const terminal = isSubagentTerminal(run);
  const query = `parentSessionId=${encodeURIComponent(run.parentSessionId)}`;
  const childBase = `/api/session/${encodeURIComponent(run.agentId)}`;
  const usage = parseAgentUsage(run);
  const duration = Math.max(0, Math.round(((run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.createdAt)) / 1000));

  useEffect(() => {
    if (terminal) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [terminal]);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    Promise.all([
      agentRequest<SessionEvent[]>(`${childBase}/events?${query}`),
      agentRequest<{ metadataJson?: string }>(`${childBase}?${query}`),
    ]).then(([events, session]) => {
      if (!active) return;
      setHistory(events);
      const metadata = session.metadataJson ? JSON.parse(session.metadataJson) : null;
      setSource(metadata?.agent?.forkPointId || null);
    }).catch((cause) => { if (active) setError(String(cause.message || cause)); });
    return () => { active = false; };
  }, [expanded, childBase, query, terminal]);

  const combined = useMemo(() => {
    const byId = new Map<string, SessionEvent>();
    const snapshots = new Map(history.filter((event) => event.type === "ASSISTANT_MESSAGE").map((event) => [event.payload.messageId, event]));
    for (const event of history) byId.set(event.eventId, event);
    for (const event of live) {
      if (event.type === "ASSISTANT_MESSAGE_DELTA") {
        const snapshot = snapshots.get(event.payload.messageId);
        if (snapshot && (event.createdAt < snapshot.createdAt || (event.createdAt === snapshot.createdAt && event.eventId <= snapshot.eventId))) continue;
      }
      byId.set(event.eventId, event);
    }
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId));
  }, [history, live]);
  const pending = live.filter((event) => event.type === "TOOL_APPROVAL_REQUIRED" && event.turnId === run.childTurnId && !closed[event.payload.approvalId]
    && !live.some((item) => item.turnId === event.turnId && (item.type === "TOOL_CALL_STARTED" || item.type === "TOOL_CALL_ENDED") && item.payload.toolCallId === event.payload.toolCallId));
  const log = buildLog(combined, terminal);

  async function resolve(tool: ToolCallView, decision: ToolApprovalDecision) {
    if (!tool.approvalId) return;
    setSubmitting(tool.approvalId); setError("");
    try {
      await agentRequest(`/api/session/${encodeURIComponent(run.parentSessionId)}/approvals/${encodeURIComponent(tool.approvalId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSubmitting(null); }
  }

  async function stop() {
    setStopping(true); setError("");
    try {
      const next = await agentRequest<SubagentRun>(`/api/session/${encodeURIComponent(run.parentSessionId)}/subagent-runs/${encodeURIComponent(run.runId)}/cancel`, { method: "POST" });
      useSubagentStore.getState().update(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStopping(false); }
  }

  const loadResult = (resultId: string) => agentRequest<ToolResultDetail>(`${childBase}/tool-results/${encodeURIComponent(resultId)}?${query}`);
  return <section className="rounded-lg border border-line bg-panel-muted/60 p-3" aria-label={`${run.role} 子任务`}>
    <div className="flex items-center gap-2 text-xs">
      <strong>{run.role === "explorer" ? "探索子任务" : "执行子任务"}</strong><span role="status">{STATUS[run.status]}</span>
      <span className="text-text-3">{run.mode === "background" ? "后台" : "前台"} · {duration} 秒 · {run.modelId}</span>
      {!terminal && <button className="ml-auto text-accent" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? "等待确认" : run.status === "CANCELLING" ? "重试停止" : "停止"}</button>}
    </div>
    <p className="mt-1 text-[11px] text-text-3">Agent {run.agentId} · 执行 {run.runId}</p>
    {usage && <p className="mt-1 text-xs text-text-3">本次执行累计消耗 {usage.totalTokens.toLocaleString()} tokens</p>}
    {log.contextUsage && expanded && <p className="mt-1 text-xs text-text-3">子会话当前上下文 {log.contextUsage.totalTokens.toLocaleString()} tokens</p>}
    {run.finalText && <div className="mt-2 max-h-60 overflow-auto"><AssistantMarkdown content={run.finalText} messageId={`subagent-result-${run.runId}`} isStreaming={false} /></div>}
    {(run.errorMessage || error) && <p className="mt-2 whitespace-pre-wrap text-xs text-red-600" role="alert">{error || run.errorMessage}</p>}
    {!terminal && pending.map((event) => {
      const tool = toolView(event);
      return tool ? <div className="mt-2" key={event.eventId}><p className="mb-1 text-xs">子 Agent {run.agentId} 请求父会话授权</p><ToolApprovalCard toolCall={{ ...tool, status: submitting === tool.approvalId ? "submitting" : "waiting_approval" }} onResolveApproval={resolve} /></div> : null;
    })}
    <div className="mt-2 flex gap-4 text-xs text-accent">
      <button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? "收起子日志" : "查看完整子日志"}</button>
      {run.resultId && <a target="_blank" rel="noreferrer" href={`${childBase}/tool-results/${encodeURIComponent(run.resultId)}/content?${query}`}>完整结果</a>}
    </div>
    {expanded && <div className="mt-3 max-h-[36rem] space-y-3 overflow-auto border-t border-line pt-3">
      <p className="text-xs text-text-3">{source ? `继承父对话快照 ${source}；这里只展示子会话新增记录，原历史可在父会话查看。` : "独立子上下文；这里只展示子会话新增记录。"}</p>
      {log.items.map((item) => item.tool ? <ToolTrace key={item.id} toolCalls={[item.tool]} sessionId={run.agentId} loadToolResult={loadResult} isRunning={!terminal && item.tool.status === "started"} toErrorMessage={(cause) => String(cause)} onAskProgress={() => {}} isCancelling={false} />
        : <div key={item.id} className="text-sm"><p className="text-xs text-text-3">{item.role}</p><AssistantMarkdown content={item.text || " "} messageId={`child-${run.agentId}-${item.id}`} isStreaming={false} /></div>)}
    </div>}
  </section>;
}

function toolView(event: SessionEvent): ToolCallView | null {
  if (event.type !== "TOOL_CALL_STARTED" && event.type !== "TOOL_CALL_ENDED" && event.type !== "TOOL_APPROVAL_REQUIRED") return null;
  const payload = event.payload;
  let parsedArguments: Record<string, unknown> | undefined;
  try { parsedArguments = JSON.parse(payload.arguments); } catch { /* 旧日志参数可能不是 JSON。 */ }
  const parsed = { argumentsText: payload.arguments, parsedArguments };
  const base: ToolCallView = { id: `${event.turnId}:${payload.toolCallId}`, turnId: event.turnId, toolName: payload.toolName, argumentsText: parsed.argumentsText, parsedArguments: parsed.parsedArguments, status: "started", errorMessage: "" };
  if (event.type === "TOOL_APPROVAL_REQUIRED") return { ...base, status: "waiting_approval", approvalId: event.payload.approvalId, approvalTitle: event.payload.title, approvalDescription: event.payload.description, permissionType: event.payload.permissionType || undefined, grantPath: event.payload.grantPath || undefined, grantOrigin: event.payload.grantOrigin || undefined, approvalIndex: event.payload.approvalIndex, approvalCount: event.payload.approvalCount };
  if (event.type === "TOOL_CALL_ENDED") return { ...base, status: event.payload.status, resultId: event.payload.resultId, durationMs: event.payload.durationMs, errorMessage: event.payload.errorMessage || "" };
  return base;
}

function buildLog(events: SessionEvent[], terminal: boolean) {
  const items = new Map<string, { id: string; text?: string; role?: string; tool?: ToolCallView }>();
  let contextUsage: ContextUsageSnapshot | null = null;
  for (const event of events) {
    if (event.type === "CONTEXT_USAGE_UPDATED") contextUsage = event.payload;
    if (event.type === "USER_MESSAGE" || event.type === "ASSISTANT_MESSAGE" || event.type === "ASSISTANT_MESSAGE_DELTA") {
      const id = event.payload.messageId;
      const existing = items.get(id);
      const text = event.type === "ASSISTANT_MESSAGE_DELTA" ? (existing?.text || "") + event.payload.text : event.payload.text;
      items.set(id, { id, text, role: event.type === "USER_MESSAGE" ? "委派消息" : "子 Agent" });
      if (event.type === "ASSISTANT_MESSAGE" && event.payload.contextUsage) contextUsage = event.payload.contextUsage;
    }
    const tool = toolView(event);
    if (tool) {
      // 历史授权只作事实记录，实时可操作卡片由父 SSE 单独维护。
      if (tool.status === "waiting_approval") { tool.status = "failed"; tool.errorMessage = "历史授权阶段，不可操作"; }
      if (terminal && tool.status === "started") { tool.status = "failed"; tool.errorMessage = "执行已结束或中断"; }
      items.set(tool.id, { id: tool.id, tool });
    }
    if (event.type === "ERROR") items.set(event.eventId, { id: event.eventId, text: event.payload.errorMessage || "执行失败", role: "系统" });
  }
  return { items: [...items.values()], contextUsage };
}
