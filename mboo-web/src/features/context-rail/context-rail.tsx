"use client";

import { memo } from "react";
import type { SessionInfo } from "@/features/sessions/session-types";
import type { ContextCompressionState, ContextUsageSnapshot, ModelContextLimit } from "@/lib/session-types";
import styles from "./context-rail.module.css";

type ContextRailProps = {
  modelName: string;
  workspacePath: string;
  workspaceStatusText: string;
  recentSessions: SessionInfo[];
  sessionPreviews: Record<string, string>;
  sessionId: string;
  pendingApprovalCount: number;
  errorMessage: string;
  isRunning: boolean;
  isCompressing: boolean;
  contextUsage: ContextUsageSnapshot | null;
  modelContextLimit: ModelContextLimit | null;
  compressionState: ContextCompressionState | null;
  compressionMessage: string;
  canCompress: boolean;
  onOpenSession: (sessionId: string) => void;
  onCompressContext: () => void;
  onStop: () => void;
};

export const ContextRail = memo(function ContextRail(props: ContextRailProps) {
  const hasNotices = props.pendingApprovalCount > 0 || Boolean(props.errorMessage) || props.isRunning;
  return (
    <aside className={styles.rail} aria-label="上下文栏">
      <section className={styles.section}>
        <SectionLabel>当前上下文</SectionLabel>
        <div className={styles.contextBody}>
          <p className={styles.agentName}>Mboo Bot</p>
          <p className={styles.contextValue} title={props.modelName || "模型在中栏配置"}>
            模型：{props.modelName.trim() || "未配置"}
          </p>
          <p className={styles.contextValue} title={props.workspacePath || props.workspaceStatusText}>
            工作区：{workspaceBasename(props.workspacePath) || props.workspaceStatusText}
          </p>
        </div>
      </section>

      {props.recentSessions.length > 0 ? (
        <section className={styles.section}>
          <SectionLabel>最近会话</SectionLabel>
          <div className={styles.sessionList}>
            {props.recentSessions.map((session) => {
              const selected = session.id === props.sessionId;
              const rowClassName = [styles.sessionRow, selected ? styles.sessionRowSelected : ""].join(" ");
              return (
                <button
                  key={session.id}
                  className={rowClassName}
                  type="button"
                  onClick={() => props.onOpenSession(session.id)}
                >
                  <span className={styles.sessionIcon} aria-hidden>#</span>
                  <span className={styles.sessionCopy}>
                    <span className={styles.sessionTitle}>
                      {sessionListTitle(session, props.sessionPreviews[session.id])}
                    </span>
                    <span className={styles.sessionTime}>{formatSessionTime(session.updatedAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasNotices ? (
        <section className={styles.section}>
          <SectionLabel>通知中心</SectionLabel>
          <div className={styles.noticeList}>
            {props.pendingApprovalCount > 0 ? (
              <p className={[styles.notice, styles.noticeWarning].join(" ")}>
                <span className={styles.noticeIcon} aria-hidden>!</span>
                <span>待授权工具：{props.pendingApprovalCount}</span>
              </p>
            ) : null}
            {props.errorMessage ? (
              <p className={[styles.notice, styles.noticeError].join(" ")}>
                <span className={styles.noticeIcon} aria-hidden>×</span>
                <span className={styles.noticeText}>最近错误：{props.errorMessage}</span>
              </p>
            ) : null}
            {props.isRunning ? (
              <p className={[styles.notice, styles.noticeRunning].join(" ")}>
                <span className={styles.noticeIcon} aria-hidden>•</span>
                <span>任务运行中</span>
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className={styles.section}>
        <SectionLabel>上下文用量</SectionLabel>
        <div className={styles.usageBody}>
          {props.contextUsage ? (
            <>
              <div className={styles.usageNumbers}>
                <span>{formatTokenCount(props.contextUsage.totalTokens)} 已用</span>
                <span>{props.modelContextLimit ? `${usagePercent(props.contextUsage.totalTokens, props.modelContextLimit.effectiveContextLimit)}%` : "上限未知"}</span>
              </div>
              {props.modelContextLimit ? (
                <>
                  <div className={styles.usageTrack} aria-label="上下文使用比例">
                    <span className={styles.usageBar} style={{ width: `${usagePercent(props.contextUsage.totalTokens, props.modelContextLimit.effectiveContextLimit)}%` }} />
                  </div>
                  <p className={styles.usageHint}>上限 {formatTokenCount(props.modelContextLimit.effectiveContextLimit)}</p>
                </>
              ) : <p className={styles.usageHint}>模型上下文上限尚未读取</p>}
            </>
          ) : (
            <p className={styles.usageHint}>等待本轮使用量</p>
          )}
          {props.compressionMessage ? (
            <p className={`${styles.compressionNotice} ${props.compressionState === "failed" ? styles.compressionNoticeError : ""}`} role="status">
              {props.compressionMessage}
            </p>
          ) : null}
          {props.canCompress ? (
            props.isCompressing ? (
              <button className={styles.compressButton} type="button" onClick={props.onStop}>停止压缩</button>
            ) : (
              <button className={styles.compressButton} disabled={props.isRunning} type="button" onClick={props.onCompressContext}>压缩上下文</button>
            )
          ) : null}
        </div>
      </section>
    </aside>
  );
});

function SectionLabel({ children }: { children: string }) {
  return <div className={styles.sectionLabel}>{children}</div>;
}

function sessionListTitle(session: SessionInfo, preview?: string) {
  const title = session.title.trim();
  if (title && title !== "新会话") return title;
  return preview?.trim() || title || "新会话";
}

function workspaceBasename(path?: string | null) {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatSessionTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return String(value);
}

function usagePercent(totalTokens: number, contextLimit: number) {
  if (contextLimit <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((totalTokens / contextLimit) * 100)));
}
