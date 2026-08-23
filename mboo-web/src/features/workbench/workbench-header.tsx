"use client";

import { Maximize2, PanelLeft, RotateCcw, Settings2 } from "lucide-react";
import { memo } from "react";
import styles from "./workbench-header.module.css";

type HeaderStatus = {
  label: string;
  running?: boolean;
  className?: string;
};

type WorkbenchHeaderProps = {
  status: HeaderStatus;
  isSidebarCollapsed: boolean;
  isFullscreen: boolean;
  onToggleSidebar: () => void;
  onToggleFullscreen: () => void;
  onResetLayout: () => void;
  onOpenModelSettings: () => void;
};

export const WorkbenchHeader = memo(function WorkbenchHeader({
  status,
  isSidebarCollapsed,
  isFullscreen,
  onToggleSidebar,
  onToggleFullscreen,
  onResetLayout,
  onOpenModelSettings,
}: WorkbenchHeaderProps) {
  return (
    <header className={styles.header}>
      <span aria-hidden className={styles.avatar}>M</span>
      <p className={styles.title}>Mboo Code</p>
      <StatusPill status={status} compact />
      <span
        aria-hidden
        className={styles.heartbeat}
        data-state={status.label === "异常" ? "error" : status.running ? "running" : "idle"}
      >
        <span className={styles.heartbeatBar} />
        <span className={styles.heartbeatBar} />
        <span className={styles.heartbeatBar} />
        <span className={styles.heartbeatBar} />
        <span className={styles.heartbeatBar} />
      </span>
      <div className={styles.spacer} />
      <div className={styles.actions}>
        <button
          className={styles.action}
          type="button"
          aria-label="打开模型服务设置"
          title="模型服务设置"
          onClick={onOpenModelSettings}
        >
          <Settings2 className={styles.actionIcon} aria-hidden />
        </button>
        <button
          className={`${styles.action} ${styles.sidebarAction}`}
          type="button"
          aria-label={isSidebarCollapsed ? "展开左侧会话栏" : "折叠左侧会话栏"}
          title={isSidebarCollapsed ? "展开会话栏" : "折叠会话栏"}
          onClick={onToggleSidebar}
        >
          <PanelLeft className={styles.actionIcon} aria-hidden />
        </button>
        <button
          className={styles.action}
          type="button"
          aria-label={isFullscreen ? "退出浏览器全屏" : "浏览器全屏"}
          title={isFullscreen ? "退出全屏" : "浏览器全屏"}
          onClick={onToggleFullscreen}
        >
          <Maximize2 className={styles.actionIcon} aria-hidden />
        </button>
        <button
          className={`${styles.action} ${styles.dangerAction}`}
          type="button"
          hidden
          aria-label="重置布局：展开侧栏并退出全屏"
          title="重置布局（不会关闭标签页）"
          onClick={onResetLayout}
        >
          <RotateCcw className={styles.actionIcon} aria-hidden />
        </button>
      </div>
    </header>
  );
});

export const StatusPill = memo(function StatusPill({
  status,
  compact = false,
}: {
  status: HeaderStatus;
  compact?: boolean;
}) {
  const tone = status.label === "异常" ? styles.statusError : status.running ? styles.statusRunning : styles.statusIdle;
  return (
    <span
      className={`${styles.status} ${tone} ${compact ? styles.statusCompact : ""}`}
      aria-live="polite"
      title={status.label}
      data-running={status.running ? "true" : undefined}
      data-error={status.label === "异常" ? "true" : undefined}
    >
      <span className={`${styles.statusDot} ${status.running ? styles.statusDotRunning : ""}`} aria-hidden />
      <span className={styles.statusLabel}>{status.label}</span>
    </span>
  );
});
