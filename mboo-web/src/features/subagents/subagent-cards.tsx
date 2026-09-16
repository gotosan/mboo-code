"use client";

import { CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Hand, LoaderCircle, TriangleAlert, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import AssistantMarkdown from "@/components/assistant-markdown";
import { ToolApprovalCard } from "@/features/tools/tool-approval-card";
import { ToolTrace } from "@/features/tools/tool-trace";
import { getToolPhaseLabel } from "@/features/tools/tool-formatters";
import type { ToolCallView } from "@/features/agent-run/message-model";
import type { SessionEvent, ToolApprovalDecision, ToolCallStatus, ToolResultDetail, ContextUsageSnapshot } from "@/lib/session-types";
import { useSubagentStore, agentRequest, isSubagentTerminal, parseAgentUsage, type SubagentRun } from "./subagent-store";

const STATUS: Record<SubagentRun["status"], string> = { STARTING: "启动中", RUNNING: "执行中", WAITING_APPROVAL: "等待授权", FINALIZING: "清理中", CANCELLING: "取消中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消", INTERRUPTED: "已中断" };
const EMPTY_EVENTS: SessionEvent[] = [];

/** 子日志默认只展开前 5 条，其余通过一级操作显式展开，避免长日志把会话推离视线。 */
const LOG_PREVIEW_COUNT = 5;

/** 行内操作统一为 28px 幽灵按钮：默认不画边框，hover 才显形；触屏放宽到 36px 保住点击精度。焦点态沿用全局 :focus-visible 规则。 */
const GHOST_BUTTON = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-[11px] leading-4 text-text-3 transition-colors hover:border-line hover:bg-panel-muted hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-60 sm:h-7";

export function SubagentCards({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const runs = useSubagentStore((state) => state.runs);
  const selected = Object.values(runs).filter((run) => run.parentSessionId === sessionId && run.parentMessageId === messageId);
  return <div className="space-y-2">{selected.map((run) => <SubagentCard key={run.runId} run={run} />)}</div>;
}

function SubagentCard({ run }: { run: SubagentRun }) {
  const [expanded, setExpanded] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [history, setHistory] = useState<SessionEvent[]>([]);
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const live = useSubagentStore((state) => state.events[run.agentId] ?? EMPTY_EVENTS);
  const closed = useSubagentStore((state) => state.closedApprovals);
  const terminal = isSubagentTerminal(run);
  const roleTitle = run.role === "explorer" ? "探索子任务" : "执行子任务";
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
  const currentAction = deriveCurrentAction(run, live, terminal, pending.length);
  const visibleLog = showAllLog ? log.items : log.items.slice(0, LOG_PREVIEW_COUNT);
  const hiddenLogCount = log.items.length - visibleLog.length;
  const metaParts = [
    run.mode === "background" ? "后台" : "前台",
    `${duration} 秒`,
    usage ? `${usage.totalTokens.toLocaleString()} tokens` : null,
  ].filter(Boolean);

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

  const identifiers = `Agent ${run.agentId} · 执行 ${run.runId} · 模型 ${run.modelId}`;
  const loadResult = (resultId: string) => agentRequest<ToolResultDetail>(`${childBase}/tool-results/${encodeURIComponent(resultId)}?${query}`);

  return (
    <section className="rounded-lg border border-line bg-panel" aria-label={`${roleTitle}，${STATUS[run.status]}`}>
      {/* Header：状态图标 + 标题 + 当前动作 + 停止按钮，风格对齐 ToolTrace trigger */}
      <header className="flex items-center gap-2 bg-panel-muted px-2.5 py-2">
        <StatusIcon status={run.status} />
        <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-text-1">{roleTitle}</strong>
        <span className="min-w-0 max-w-[40%] truncate text-xs text-text-3" title={identifiers}>{currentAction}</span>
        {!terminal && (
          <button
            className={`${GHOST_BUTTON} hover:text-danger`}
            type="button"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? "等待确认" : run.status === "CANCELLING" ? "重试停止" : "停止"}
          </button>
        )}
      </header>

      {/* 内容预览：收起时显示 2 行，展开时显示完整内容 */}
      {run.finalText && (
        <div className="border-t border-line px-3 py-2">
          {expanded ? (
            <div className="max-h-60 overflow-auto rounded-md bg-panel-muted/30 p-2">
              <AssistantMarkdown content={run.finalText} messageId={`subagent-result-${run.runId}`} isStreaming={false} />
            </div>
          ) : (
            <p className="line-clamp-2 text-sm leading-5 text-text-2">{run.finalText}</p>
          )}
        </div>
      )}

      {/* 错误信息 */}
      {(run.errorMessage || error) && (
        <div className="border-t border-line px-3 py-2">
          <p className="text-xs leading-5 text-danger" role="alert">{error || run.errorMessage}</p>
        </div>
      )}

      {/* 授权请求 */}
      {!terminal && pending.map((event) => {
        const tool = toolView(event);
        return tool ? (
          <div className="border-t border-line px-3 py-2" key={event.eventId}>
            <p className="mb-1 text-[11px] leading-4 text-text-3">{roleTitle}请求父会话授权</p>
            <ToolApprovalCard toolCall={{ ...tool, status: submitting === tool.approvalId ? "submitting" : "waiting_approval" }} onResolveApproval={resolve} />
          </div>
        ) : null;
      })}

      {/* 收起状态：Meta + 查看详情 */}
      {!expanded && metaParts.length > 0 && (
        <footer className="flex items-center justify-between border-t border-line px-3 py-1.5">
          <p className="text-[11px] text-text-3">{metaParts.join(" · ")}</p>
          <button
            type="button"
            className="text-xs text-accent transition-colors hover:text-accent-strong"
            onClick={() => setExpanded(true)}
          >
            查看详情
          </button>
        </footer>
      )}

      {/* 展开状态：完整内容 */}
      {expanded && (
        <>
          {/* Meta 信息 */}
          <div className="border-t border-line px-3 py-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <span className="text-text-3">模式</span>
              <span className="text-text-2">{run.mode === "background" ? "后台" : "前台"}</span>
              <span className="text-text-3">耗时</span>
              <span className="text-text-2">{duration} 秒</span>
              {usage && (
                <>
                  <span className="text-text-3">Tokens</span>
                  <span className="text-text-2">{usage.totalTokens.toLocaleString()}</span>
                </>
              )}
              {log.contextUsage && (
                <>
                  <span className="text-text-3">上下文</span>
                  <span className="text-text-2">{log.contextUsage.totalTokens.toLocaleString()} tokens</span>
                </>
              )}
              <span className="text-text-3">来源</span>
              <span className="text-text-2">{source ? `继承父对话快照 ${source}` : "独立子上下文"}</span>
            </div>
          </div>

          {/* 子日志 */}
          {log.items.length > 0 && (
            <div className="border-t border-line px-3 py-2">
              <p className="mb-2 text-[11px] font-medium text-text-3">日志</p>
              <div className="space-y-1.5">
                {visibleLog.map((item) => item.tool ? (
                  <div key={item.id} className="rounded-md bg-panel-muted/30 px-2 py-1.5">
                    <ToolTrace toolCalls={[item.tool]} sessionId={run.agentId} loadToolResult={loadResult} isRunning={!terminal && item.tool.status === "started"} toErrorMessage={(cause) => String(cause)} onAskProgress={() => {}} isCancelling={false} />
                  </div>
                ) : (
                  <div key={item.id} className="rounded-md bg-panel-muted/30 px-2 py-1.5">
                    <p className="mb-0.5 text-[11px] leading-4 text-text-3">{item.role}</p>
                    <div className="text-sm"><AssistantMarkdown content={item.text || " "} messageId={`child-${run.agentId}-${item.id}`} isStreaming={false} /></div>
                  </div>
                ))}
              </div>
              {log.items.length > LOG_PREVIEW_COUNT && (
                <button
                  type="button"
                  className="mt-2 text-xs text-text-3 transition-colors hover:text-text-1"
                  aria-expanded={showAllLog}
                  onClick={() => setShowAllLog((current) => !current)}
                >
                  {showAllLog ? "收起明细" : `查看全部 ${log.items.length} 项（还有 ${hiddenLogCount} 项）`}
                </button>
              )}
            </div>
          )}

          {/* 标识符 */}
          <div className="border-t border-line px-3 py-2">
            <p className="truncate text-[11px] text-text-3">{identifiers}</p>
          </div>

          {/* Footer：收起 + 完整结果 */}
          <footer className="flex items-center gap-3 border-t border-line px-3 py-1.5">
            <button
              type="button"
              className="text-xs text-text-3 transition-colors hover:text-text-1"
              onClick={() => setExpanded(false)}
            >
              收起子日志
            </button>
            {run.resultId && (
              <a
                className="text-xs text-text-3 transition-colors hover:text-accent"
                target="_blank"
                rel="noreferrer"
                href={`${childBase}/tool-results/${encodeURIComponent(run.resultId)}/content?${query}`}
              >
                完整结果
              </a>
            )}
          </footer>
        </>
      )}
    </section>
  );
}

/** 状态图标：24×24 圆形底色 + 14×14 图标，颜色与形状先于文字被读到。 */
function StatusIcon({ status }: { status: SubagentRun["status"] }) {
  const base = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
  if (status === "SUCCEEDED") return <span className={`${base} bg-ok-soft text-ok`}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /></span>;
  if (status === "FAILED") return <span className={`${base} bg-danger-soft text-danger`}><XCircle className="h-3.5 w-3.5" aria-hidden /></span>;
  if (status === "INTERRUPTED") return <span className={`${base} bg-danger-soft text-danger`}><TriangleAlert className="h-3.5 w-3.5" aria-hidden /></span>;
  if (status === "CANCELLED") return <span className={`${base} bg-panel text-text-3`}><CircleSlash className="h-3.5 w-3.5" aria-hidden /></span>;
  if (status === "WAITING_APPROVAL") return <span className={`${base} bg-running-soft text-running`}><Hand className="h-3.5 w-3.5" aria-hidden /></span>;
  return <span className={`${base} bg-running-soft text-running`}><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /></span>;
}

/**
 * 第三槽「当前动作」由子事件流推导，而不是读服务端进度字段：
 * 优先取仍未收尾的工具调用，其次是正在生成的回复，最后才退回 run 状态。
 * 这样卡片在未展开子日志时也有具体内容可读。
 */
function deriveCurrentAction(run: SubagentRun, live: SessionEvent[], terminal: boolean, pendingApprovalCount: number) {
  if (terminal) {
    if (run.status === "SUCCEEDED") return "结果已回传父会话";
    if (run.status === "CANCELLED") return "已按请求取消，未继续执行";
    if (run.status === "INTERRUPTED") return "应用重启时中断，未自动重放";
    return run.errorMessage ? "执行失败，原因见下方提示" : "执行失败";
  }
  if (pendingApprovalCount > 0) return "等待你在输入框上方授权";
  if (run.status === "CANCELLING") return "正在等待父会话确认取消";
  if (run.status === "FINALIZING") return "正在清理子会话资源";
  if (run.status === "STARTING") return "正在准备子会话上下文";

  const openTools = new Map<string, { toolName: string; status: ToolCallStatus }>();
  for (const event of live) {
    if (event.type === "TOOL_CALL_STARTED") openTools.set(event.payload.toolCallId, { toolName: event.payload.toolName, status: "started" });
    else if (event.type === "TOOL_APPROVAL_REQUIRED") openTools.set(event.payload.toolCallId, { toolName: event.payload.toolName, status: "waiting_approval" });
    else if (event.type === "TOOL_CALL_ENDED") openTools.delete(event.payload.toolCallId);
  }
  const running = [...openTools.values()].at(-1);
  if (running) return getToolPhaseLabel(running.toolName, running.status);

  const last = live[live.length - 1];
  if (last?.type === "ASSISTANT_MESSAGE_DELTA" || last?.type === "ASSISTANT_MESSAGE") return "正在生成回复";
  return STATUS[run.status];
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
