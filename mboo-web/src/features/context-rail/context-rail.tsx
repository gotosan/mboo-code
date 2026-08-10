"use client";

import { memo } from "react";
import type { SessionInfo } from "@/features/sessions/session-types";
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
  onOpenSession: (sessionId: string) => void;
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