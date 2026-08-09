"use client";

import {
  Archive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import styles from "./session-list-panel.module.css";
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type {
  SessionConfirmAction,
  SessionInfo,
  SessionListTab,
} from "@/features/sessions/session-types";

type SessionListPanelProps = {
  visibleSessions: SessionInfo[];
  sessionPreviews: Record<string, string>;
  highlightedSessionId: string;
  sessionListTab: SessionListTab;
  sessionQuery: string;
  isLoadingSessions: boolean;
  sessionListError: string;
  sessionMessage: string;
  isRunning: boolean;
  isSelectingWorkspace: boolean;
  isSessionSwitching: boolean;
  isCurrentSessionRunning: boolean;
  editingSessionId: string | null;
  titleDraft: string;
  confirmingAction: SessionConfirmAction;
  onQueryChange: (value: string) => void;
  onCreateSession: () => void;
  onRefresh: () => void;
  onTabChange: (tab: SessionListTab) => void;
  onOpenSession: (session: SessionInfo) => void;
  onBeginRename: (session: SessionInfo) => void;
  onTitleDraftChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onArchive: (session: SessionInfo) => void;
  onUnarchive: (session: SessionInfo) => void;
  onDelete: (session: SessionInfo) => void;
  onConfirmActionChange: (action: SessionConfirmAction) => void;
};

export const SessionListPanel = memo(function SessionListPanel({
  visibleSessions,
  sessionPreviews,
  highlightedSessionId,
  sessionListTab,
  sessionQuery,
  isLoadingSessions,
  sessionListError,
  sessionMessage,
  isRunning,
  isSelectingWorkspace,
  isSessionSwitching,
  isCurrentSessionRunning,
  editingSessionId,
  titleDraft,
  confirmingAction,
  onQueryChange,
  onCreateSession,
  onRefresh,
  onTabChange,
  onOpenSession,
  onBeginRename,
  onTitleDraftChange,
  onSubmitRename,
  onCancelRename,
  onArchive,
  onUnarchive,
  onDelete,
  onConfirmActionChange,
}: SessionListPanelProps) {
  const isArchivedView = sessionListTab === "archived";
  const actionDisabled = isSessionSwitching || isSelectingWorkspace;

  return (
    <>
      <label className={styles.searchField}>
        <Search className={styles.searchIcon} aria-hidden />
        <span className="sr-only">过滤会话</span>
        <input
          className={styles.searchInput}
          placeholder="搜索会话"
          value={sessionQuery}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>

      <div className={styles.actionRow}>
        <button
          className={styles.primaryButton}
          disabled={isRunning || isSelectingWorkspace}
          type="button"
          onClick={onCreateSession}
        >
          <span className={styles.buttonIcon} aria-hidden>＋</span>
          新会话
        </button>
        <button
          aria-label="刷新会话列表"
          className={styles.secondaryButton}
          disabled={isLoadingSessions}
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw className={`size-3.5 ${isLoadingSessions ? "motion-safe:animate-spin" : ""}`} aria-hidden />
        </button>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="会话分类">
        {(["active", "archived"] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={sessionListTab === tab}
            className={`${styles.tab} ${sessionListTab === tab ? styles.tabSelected : ""}`}
            type="button"
            onClick={() => onTabChange(tab)}
          >
            {tab === "active" ? "活跃" : "归档"}
          </button>
        ))}
      </div>

      {sessionListError ? (
        <div className={styles.errorBox} role="alert">
          <p className={styles.errorTitle}>{sessionListError}</p>
          <p className={styles.errorDescription}>仍可新建任务；历史会话恢复后会自动可用。</p>
          <div className={styles.errorActions}>
            <button
              className={`${styles.smallButton} ${styles.dangerButton}`}
              type="button"
              disabled={isLoadingSessions}
              onClick={onRefresh}
            >
              <RefreshCw className={`size-3 ${isLoadingSessions ? "motion-safe:animate-spin" : ""}`} aria-hidden />
              重试
            </button>
            <button
              className={styles.smallPrimaryButton}
              type="button"
              disabled={isRunning || isSelectingWorkspace}
              onClick={onCreateSession}
            >
              新建任务
            </button>
          </div>
        </div>
      ) : null}

      {sessionMessage ? (
        <p className={styles.feedback} role="status">
          {sessionMessage}
        </p>
      ) : null}

      <div className={styles.groupHeader}>
        {isArchivedView ? <ChevronRight className={styles.groupIcon} aria-hidden /> : <ChevronDown className={styles.groupIcon} aria-hidden />}
        <span>{isArchivedView ? "已归档" : "正在进行"}（{visibleSessions.length}）</span>
      </div>

      <div className={styles.sessionScroller}>
        {isLoadingSessions ? (
          <div className={`${styles.emptyBox} ${styles.emptyBoxCompact}`}>正在加载会话</div>
        ) : sessionListError ? (
          <div className={`${styles.emptyBox} ${styles.emptyBoxCompact}`}>列表暂时为空。可先新建任务，或使用上方重试。</div>
        ) : visibleSessions.length === 0 ? (
          <div className={styles.emptyBox}>
            <p className={styles.emptyTitle}>{sessionQuery.trim() ? "没有匹配的会话" : isArchivedView ? "暂无归档会话" : "暂无活跃会话"}</p>
            <p className={styles.emptyDescription}>{sessionQuery.trim() ? "试试其他关键词" : "从新会话开始一次任务"}</p>
          </div>
        ) : (
          visibleSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              preview={sessionPreviews[session.id]}
              selected={session.id === highlightedSessionId}
              archived={isArchivedView}
              editing={editingSessionId === session.id}
              titleDraft={titleDraft}
              confirmingAction={confirmingAction}
              actionDisabled={actionDisabled}
              isCurrentSessionRunning={isCurrentSessionRunning}
              onOpen={() => onOpenSession(session)}
              onBeginRename={() => onBeginRename(session)}
              onTitleDraftChange={onTitleDraftChange}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onArchive={() => onArchive(session)}
              onUnarchive={() => onUnarchive(session)}
              onDelete={() => onDelete(session)}
              onConfirmActionChange={onConfirmActionChange}
            />
          ))
        )}
      </div>
    </>
  );
});

type SessionRowProps = {
  session: SessionInfo;
  preview?: string;
  selected: boolean;
  archived: boolean;
  editing: boolean;
  titleDraft: string;
  confirmingAction: SessionConfirmAction;
  actionDisabled: boolean;
  isCurrentSessionRunning: boolean;
  onOpen: () => void;
  onBeginRename: () => void;
  onTitleDraftChange: (value: string) => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onConfirmActionChange: (action: SessionConfirmAction) => void;
};

const SessionRow = memo(function SessionRow({
  session,
  preview,
  selected,
  archived,
  editing,
  titleDraft,
  confirmingAction,
  actionDisabled,
  isCurrentSessionRunning,
  onOpen,
  onBeginRename,
  onTitleDraftChange,
  onSubmitRename,
  onCancelRename,
  onArchive,
  onUnarchive,
  onDelete,
  onConfirmActionChange,
}: SessionRowProps) {
  const menuId = useId();
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const confirmingArchive = confirmingAction?.type === "archive" && confirmingAction.id === session.id;
  const confirmingDelete = confirmingAction?.type === "delete" && confirmingAction.id === session.id;

  const closeMenu = () => setIsMenuOpen(false);
  const updateMenuPosition = () => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setMenuPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 128),
      left: Math.max(8, rect.right - 164),
    });
  };
  const toggleMenu = () => {
    if (isMenuOpen) {
      closeMenu();
      return;
    }
    updateMenuPosition();
    setIsMenuOpen(true);
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeMenu();
    menuTriggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isMenuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleViewportChange = () => updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isMenuOpen]);

  const handleArchiveClick = () => {
    if (confirmingArchive) {
      onConfirmActionChange(null);
      onArchive();
      return;
    }
    onConfirmActionChange({ type: "archive", id: session.id });
  };
  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onConfirmActionChange(null);
      onDelete();
      return;
    }
    onConfirmActionChange({ type: "delete", id: session.id });
  };

  return (
    <div className={`${styles.sessionItem} ${selected ? styles.sessionItemSelected : ""}`}>
      {editing && !archived ? (
        <div>
          <label>
            <span className="sr-only">会话标题</span>
            <input className={styles.titleInput} maxLength={80} value={titleDraft} onChange={(event) => onTitleDraftChange(event.target.value)} />
          </label>
          <div className={styles.renameActions}>
            <button className={`${styles.primaryButton} ${styles.renameAction}`} type="button" onClick={onSubmitRename}>保存</button>
            <button className={`${styles.secondaryButton} ${styles.renameAction}`} type="button" onClick={onCancelRename}>取消</button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.sessionMainRow}>
            <button className={styles.sessionOpenButton} disabled={actionDisabled} type="button" onClick={onOpen}>
              <span aria-hidden className={styles.sessionAvatar}>#</span>
              <span className={styles.sessionCopy}>
                <span className={styles.sessionTitle}>{sessionListTitle(session, preview)}</span>
                <span className={styles.sessionMeta}>
                  {session.workspacePath ? <span className={styles.sessionMetaWorkspace} title={session.workspacePath}>{workspaceBasename(session.workspacePath)}</span> : "未设置工作区"}
                </span>
              </span>
              <span className={styles.sessionMetaTime}>{formatSessionTime(archived ? session.archivedAt || session.updatedAt : session.updatedAt)}</span>
            </button>
            <button
              ref={menuTriggerRef}
              aria-controls={isMenuOpen ? menuId : undefined}
              aria-expanded={isMenuOpen}
              aria-haspopup="menu"
              aria-label={`${sessionListTitle(session, preview)}的更多操作`}
              className={styles.menuTrigger}
              disabled={actionDisabled}
              type="button"
              onClick={toggleMenu}
            >
              <MoreHorizontal aria-hidden className={styles.menuTriggerIcon} />
            </button>
          </div>
          {isMenuOpen && typeof document !== "undefined"
            ? createPortal(
              <div
                ref={menuRef}
                id={menuId}
                aria-label={`${sessionListTitle(session, preview)}的操作菜单`}
                className={styles.sessionMenu}
                role="menu"
                style={menuPosition}
                onKeyDown={handleMenuKeyDown}
              >
                {archived ? (
                  <>
                    <button className={styles.menuItem} disabled={actionDisabled} role="menuitem" type="button" onClick={() => { onUnarchive(); closeMenu(); }}>取消归档</button>
                    <button className={`${styles.menuItem} ${styles.menuItemDanger}`} disabled={actionDisabled} role="menuitem" type="button" onClick={handleDeleteClick}>
                      <Trash2 className={styles.menuItemIcon} aria-hidden />{confirmingDelete ? "确认删除？" : "删除"}
                    </button>
                  </>
                ) : (
                  <>
                    <button className={styles.menuItem} disabled={actionDisabled} role="menuitem" type="button" onClick={() => { onBeginRename(); closeMenu(); }}>重命名</button>
                    <button className={styles.menuItem} disabled={actionDisabled || (selected && isCurrentSessionRunning)} role="menuitem" type="button" onClick={handleArchiveClick}>
                      <Archive className={styles.menuItemIcon} aria-hidden />{confirmingArchive ? "确认归档？" : "归档"}
                    </button>
                  </>
                )}
              </div>,
              document.body,
            )
            : null}
        </>
      )}
    </div>
  );
});

function sessionListTitle(session: SessionInfo, preview?: string) {
  return session.title?.trim() || preview?.trim() || "未命名会话";
}

function formatSessionTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function workspaceBasename(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").pop() || path;
}
