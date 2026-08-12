"use client";

import { Copy, LoaderCircle, Menu, RotateCcw } from "lucide-react";
import { memo, type RefObject } from "react";
import { StatusPill } from "@/features/workbench/workbench-header";
import styles from "./conversation-status-panel.module.css";

type ConversationStatus = {
  label: string;
  running?: boolean;
  className?: string;
};

type ConversationStatusPanelProps = {
  title: string;
  archived: boolean;
  status: ConversationStatus;
  errorMessage: string;
  hasRetryInput: boolean;
  sessionMenuButtonRef: RefObject<HTMLButtonElement | null>;
  isSessionDrawerOpen: boolean;
  onOpenSessionDrawer: () => void;
  onCopyError: () => void;
  onRetryInput: () => void;
  onClearError: () => void;
};

export const ConversationStatusPanel = memo(function ConversationStatusPanel({
  title,
  archived,
  status,
  errorMessage,
  hasRetryInput,
  sessionMenuButtonRef,
  isSessionDrawerOpen,
  onOpenSessionDrawer,
  onCopyError,
  onRetryInput,
  onClearError,
}: ConversationStatusPanelProps) {
  const showStatus = status.running || status.label === "异常" || status.label === "连接中";

  return (
    <section className={styles.panel} aria-label="当前会话状态">
      <div className={styles.titleBar}>
        <button
          ref={sessionMenuButtonRef}
          aria-label="打开会话列表"
          aria-expanded={isSessionDrawerOpen}
          aria-haspopup="dialog"
          className={styles.sessionMenuButton}
          type="button"
          onClick={onOpenSessionDrawer}
        >
          <Menu className={styles.menuIcon} aria-hidden />
        </button>
        <div className={styles.titleContent}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {archived ? <span className={styles.archiveBadge}>归档只读</span> : null}
            {showStatus ? <StatusPill status={status} /> : null}
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className={styles.errorNotice} role="alert">
          <p className={styles.errorMessage}>{errorMessage}</p>
          <div className={styles.errorActions}>
            <button className={`${styles.errorAction} ${styles.errorActionDanger}`} type="button" onClick={onCopyError}>
              <Copy className={styles.actionIcon} aria-hidden />
              复制错误
            </button>
            {hasRetryInput ? (
              <button className={`${styles.errorAction} ${styles.errorActionDanger}`} type="button" onClick={onRetryInput}>
                <RotateCcw className={styles.actionIcon} aria-hidden />
                回填上次输入
              </button>
            ) : null}
            <button className={styles.errorAction} type="button" onClick={onClearError}>
              清除
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
});

export const ConversationLoadingState = memo(function ConversationLoadingState() {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <LoaderCircle className={styles.loadingIcon} aria-hidden />
      <p className={styles.loadingText}>读取会话事件</p>
    </div>
  );
});
