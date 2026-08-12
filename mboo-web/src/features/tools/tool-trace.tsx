"use client";

import { ChevronDown, ChevronRight, Copy, LoaderCircle, RefreshCw, Wrench } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import AssistantMarkdown from "@/components/assistant-markdown";
import type { ToolCallView, ToolResultLoader } from "@/features/agent-run/message-model";
import {
  getToolLabel,
  shouldShowDiff,
  toolStatusLabel,
} from "@/features/tools/tool-formatters";
import type { ToolResultDetail } from "@/lib/session-types";
import styles from "./tool-trace.module.css";

export const PENDING_SESSION_KEY = "__pending__";

type ToolTraceProps = {
  toolCalls: ToolCallView[];
  isRunning: boolean;
  sessionId: string;
  loadToolResult: ToolResultLoader;
  toErrorMessage: (error: unknown) => string;
};

export const ToolTrace = memo(function ToolTrace({
  toolCalls,
  isRunning,
  sessionId,
  loadToolResult,
  toErrorMessage,
}: ToolTraceProps) {
  const [open, setOpen] = useState(false);
  const hasPendingApproval = toolCalls.some(
    (tool) => tool.status === "waiting_approval" || tool.status === "submitting",
  );
  const runningCount = toolCalls.filter(
    (tool) => tool.status === "started" || tool.status === "waiting_approval" || tool.status === "submitting",
  ).length;
  const summaryText = isRunning || runningCount > 0
    ? toolCalls.length > 1
      ? `调用工具中 · ${runningCount}/${toolCalls.length}`
      : "调用工具中"
    : toolCalls.length > 1
      ? `调用了 ${toolCalls.length} 个工具`
      : "调用了一个工具";

  return (
    <section className={styles.trace} aria-label="工具调用">
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <ChevronDown className={styles.chevron} aria-hidden /> : <ChevronRight className={styles.chevron} aria-hidden />}
        {isRunning ? <LoaderCircle className={styles.loadingIcon} aria-hidden /> : <Wrench className={styles.traceIcon} aria-hidden />}
        <span className={styles.summary}>{summaryText}</span>
        {hasPendingApproval ? <span className={styles.waitingBadge}>等待授权</span> : null}
        <span className={styles.count}>{toolCalls.length}</span>
      </button>
      {open ? (
        <div className={styles.traceBody}>
          <div className={styles.itemList}>
            {toolCalls.map((toolCall) => (
              <ToolTraceItem
                key={toolCall.id}
                toolCall={toolCall}
                sessionId={sessionId}
                loadToolResult={loadToolResult}
                toErrorMessage={toErrorMessage}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
});

const ToolTraceItem = memo(function ToolTraceItem({
  toolCall,
  sessionId,
  loadToolResult,
  toErrorMessage,
}: {
  toolCall: ToolCallView;
  sessionId: string;
  loadToolResult: ToolResultLoader;
  toErrorMessage: (error: unknown) => string;
}) {
  const [open, setOpen] = useState(false);
  const [resultState, setResultState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [resultDetail, setResultDetail] = useState<ToolResultDetail | null>(null);
  const [resultError, setResultError] = useState("");
  const previousStatusRef = useRef(toolCall.status);
  const [hasCompletionImpact, setHasCompletionImpact] = useState(false);
  const toolLabel = getToolLabel(toolCall.toolName);

  useEffect(() => {
    // 工具从执行态进入完成态时只播放一次，避免父级刷新导致重复闪烁。
    const shouldPlayImpact = toolCall.status === "completed" && previousStatusRef.current !== "completed";
    previousStatusRef.current = toolCall.status;
    if (!shouldPlayImpact) return;

    setHasCompletionImpact(true);
    const timer = window.setTimeout(() => setHasCompletionImpact(false), 360);
    return () => window.clearTimeout(timer);
  }, [toolCall.status]);

  const requestResult = useCallback(async (force = false) => {
    if (!toolCall.resultId || sessionId === PENDING_SESSION_KEY) return;
    setResultState("loading");
    setResultError("");
    try {
      const detail = await loadToolResult(toolCall.resultId, force);
      setResultDetail(detail);
      setResultState("loaded");
    } catch (error) {
      setResultState("error");
      setResultError(toErrorMessage(error));
    }
  }, [loadToolResult, sessionId, toErrorMessage, toolCall.resultId]);

  useEffect(() => {
    setResultDetail(null);
    setResultError("");
    setResultState("idle");
  }, [toolCall.resultId]);

  useEffect(() => {
    if (open && toolCall.resultId && resultState === "idle") void requestResult();
  }, [open, requestResult, resultState, toolCall.resultId]);

  return (
    <article className={`${styles.item} ${hasCompletionImpact ? styles.completionImpact : ""}`} data-status={toolCall.status}>
      <span aria-hidden className={styles.progressLine} />
      {hasCompletionImpact ? <span aria-hidden className={styles.completionSweep} /> : null}
      <button
        className={styles.itemTrigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={styles.itemTitle}>{toolLabel}</span>
        {toolCall.pathText ? <span className={styles.path} title={toolCall.pathText}>· {toolCall.pathText}</span> : <span className={styles.spacer} />}
        <span className={`${styles.status} ${statusClassName(toolCall.status)}`}>{toolStatusLabel(toolCall.status)}</span>
        <span className={styles.duration} aria-label={typeof toolCall.durationMs === "number" ? `耗时 ${toolCall.durationMs} 毫秒` : undefined}>
          {typeof toolCall.durationMs === "number" ? `${toolCall.durationMs}ms` : "—"}
        </span>
      </button>
      {open ? (
        <div className={styles.itemBody}>
          {toolLabel !== toolCall.toolName ? <p className={styles.toolName}>{toolCall.toolName}</p> : null}
          {toolCall.argumentsText ? <CopyableToolText ariaLabel="复制工具参数" text={toolCall.argumentsText} /> : null}
          {resultState === "loading" ? (
            <p className={styles.resultLoading} role="status"><LoaderCircle className={styles.loadingIcon} aria-hidden />加载工具结果</p>
          ) : null}
          {(toolCall.status === "completed" || toolCall.status === "failed") && !toolCall.resultId ? (
            <p className={styles.unavailable}>工具结果不可用</p>
          ) : null}
          {resultState === "loaded" && resultDetail?.resultPreview ? (
            <ToolResultPreview messageId={toolCall.id} toolName={toolCall.toolName} parsedArguments={toolCall.parsedArguments} text={resultDetail.resultPreview} />
          ) : null}
          {resultState === "error" ? (
            <div className={styles.resultError}>
              <p className={styles.errorText}>{resultError || "工具结果加载失败"}</p>
              <button
                className={styles.iconButton}
                type="button"
                aria-label="重试加载工具结果"
                title="重试加载工具结果"
                onClick={() => void requestResult(true)}
              >
                <RefreshCw className={styles.retryIcon} aria-hidden />
              </button>
            </div>
          ) : null}
          {toolCall.errorMessage || toolCall.errorCode ? (
            <div className={styles.detailError}>
              {toolCall.errorMessage ? <p className={styles.detailErrorMessage}>{toolCall.errorMessage}</p> : null}
              {toolCall.errorCode ? <p className={styles.errorCode}>{toolCall.errorCode}</p> : null}
            </div>
          ) : null}
          {toolCall.status === "waiting_approval" || toolCall.status === "submitting" ? (
            <p className={styles.approvalNote}>授权操作在输入框上方，请在底部完成允许或拒绝。</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

const CopyableToolText = memo(function CopyableToolText({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }, [text]);

  return (
    <div className={styles.copyable}>
      <button className={styles.copyButton} type="button" aria-label={ariaLabel} onClick={() => void copy()}>
        <Copy className={styles.copyIcon} aria-hidden />
        {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
      </button>
      <pre className={styles.code}>{text}</pre>
    </div>
  );
});

const ToolResultPreview = memo(function ToolResultPreview({
  toolName,
  messageId,
  parsedArguments,
  text,
}: {
  toolName: string;
  messageId: string;
  parsedArguments?: Record<string, unknown>;
  text: string;
}) {
  const useMarkdown = toolName === "web_search" || toolName === "web_fetch" && parsedArguments?.format !== "text";
  if (useMarkdown) return <AssistantMarkdown content={text} messageId={`tool-preview-${messageId}`} />;
  if (!shouldShowDiff(toolName, text)) return <CopyableToolText ariaLabel="复制工具结果" text={text} />;

  return (
    <div className={styles.diff}>
      <DiffCopyButton text={text} />
      <div className={styles.diffCode}>
        {text.split("\n").map((line, index) => (
          <div key={`${index}_${line.slice(0, 16)}`} className={`${styles.diffLine} ${diffLineClassName(line)}`}>{line || " "}</div>
        ))}
      </div>
    </div>
  );
});

const DiffCopyButton = memo(function DiffCopyButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  }, [text]);

  return (
    <button className={styles.copyButton} type="button" aria-label="复制工具结果" onClick={() => void copy()}>
      <Copy className={styles.copyIcon} aria-hidden />
      {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
    </button>
  );
});

function statusClassName(status: ToolCallView["status"]) {
  if (status === "waiting_approval") return styles.statusWaiting;
  if (status === "submitting") return styles.statusSubmitting;
  if (status === "started") return styles.statusStarted;
  if (status === "completed") return styles.statusCompleted;
  return styles.statusFailed;
}

function diffLineClassName(line: string) {
  if (line.includes("已截断，省略") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@")) {
    return styles.diffMeta;
  }
  if (line.startsWith("+")) return styles.diffAdded;
  if (line.startsWith("-")) return styles.diffRemoved;
  return "";
}
