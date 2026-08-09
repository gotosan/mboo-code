"use client";

import type { FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react";
import { TaskComposer } from "@/features/composer/task-composer";
import { ContextRail } from "@/features/context-rail/context-rail";
import { WorkbenchHeader } from "@/features/workbench/workbench-header";
import layoutStyles from "@/features/workbench/workbench-layout.module.css";
import { ConversationLoadingState, ConversationStatusPanel } from "@/features/conversation/conversation-status-panel";
import { MessageList } from "@/features/conversation/message-list";
import { SessionListPanel } from "@/features/sessions/session-list-panel";
import sidebarStyles from "@/features/sessions/session-sidebar.module.css";
import type { SessionConfirmAction, SessionInfo as FeatureSessionInfo, SessionListTab as FeatureSessionListTab, WorkspaceInfo as FeatureWorkspaceInfo } from "@/features/sessions/session-types";
import { ToolApprovalCard } from "@/features/tools/tool-approval-card";
import { readSessionEventStream } from "@/lib/session-stream";
import type {
  AssistantMessageState,
  ChatReq,
  SessionEvent,
  ToolApprovalDecision,
  ToolCallStatus,
  ToolPermissionType,
  ToolResultDetail,
} from "@/lib/session-types";

const STORAGE_KEYS = {
  sessionId: "mboo-web.sessionId",
  modelName: "mboo-web.modelName",
  reasoningEffort: "mboo-web.reasoningEffort",
  sessionPreviews: "mboo-web.sessionPreviews",
  recentInputs: "mboo-web.recentInputs",
};

const RECENT_INPUT_LIMIT = 5;

const TOOL_LABELS: Record<string, string> = {
  glob_files: "查找文件",
  search_text: "搜索文本",
  read_file: "读取文件",
  edit_file: "编辑文件",
  write_file: "写入文件",
  run_command: "执行命令",
};

const FILE_TOOL_NAMES = new Set([
  "glob_files",
  "search_text",
  "read_file",
  "edit_file",
  "write_file",
]);

/** 新建会话在拿到后端 sessionId 前，消息暂存用的本地键 */
const PENDING_SESSION_KEY = "__pending__";

type MessageRole = "user" | "assistant" | "system";
type MessageState = AssistantMessageState | "streaming" | "info";
type ConnectionState = "idle" | "running" | "error";

type ToolCallView = {
  id: string;
  turnId?: string | null;
  toolName: string;
  status: ToolCallStatus;
  argumentsText: string;
  parsedArguments?: Record<string, unknown>;
  pathText?: string;
  resultId?: string;
  resultSizeBytes?: number;
  rawOutputAvailable?: boolean;
  errorCode?: string;
  errorMessage: string;
  durationMs?: number;
  createdAt?: string;
  approvalId?: string;
  approvalTitle?: string;
  approvalDescription?: string;
  permissionType?: ToolPermissionType;
  grantPath?: string;
  approvalIndex?: number;
  approvalCount?: number;
};

// 助手消息按事件序交错：text / tool，避免工具永远沉底
type AssistantTextPart = {
  type: "text";
  id: string;
  text: string;
};

type AssistantToolPart = {
  type: "tool";
  id: string;
  toolCall: ToolCallView;
};

type AssistantPart = AssistantTextPart | AssistantToolPart;

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  state?: MessageState;
  turnId?: string | null;
  createdAt?: string;
  modelName?: string;
  /** 助手时间线；有值时渲染以 parts 为准 */
  parts?: AssistantPart[];
  /** 由 parts 派生，供授权统计等复用 */
  toolCalls?: ToolCallView[];
};

type SessionStatus = "active" | "archived";
type SessionListTab = "active" | "archived";

type SessionInfo = {
  id: string;
  title: string;
  status: SessionStatus;
  transcriptUri?: string | null;
  activeTurnId?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  archivedAt?: string | null;
  metadataJson?: string | null;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  code?: number;
  msg?: string;
  message?: string;
  exception?: string;
};

type WorkspaceSelectResp = {
  workspacePath?: string | null;
};

type ToolCallEvent = Extract<
  SessionEvent,
  {
    type: "TOOL_CALL_STARTED" | "TOOL_CALL_ENDED" | "TOOL_APPROVAL_REQUIRED";
  }
>;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([]);
  const [sessionListTab, setSessionListTab] =
    useState<SessionListTab>("active");
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [modelName, setModelName] = useState("");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelOptionsError, setModelOptionsError] = useState("");
  const [isLoadingModelOptions, setIsLoadingModelOptions] = useState(true);
  const [isManualModel, setIsManualModel] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  // 列表加载失败单独成态：避免与重命名/归档提示混用，并支持就近重试
  const [sessionListError, setSessionListError] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  // 正在打开的目标会话：拉取完成前不切换主线程，只做侧栏高亮与轻量进度
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  // 内联两步确认：归档/删除会话（T9，替代原生 window.confirm）
  const [confirmingAction, setConfirmingAction] = useState<{ type: "archive" | "delete"; id: string } | null>(null);
  const [viewingSessionStatus, setViewingSessionStatus] =
    useState<SessionStatus | null>(null);
  const [workspaces, setWorkspaces] = useState<FeatureWorkspaceInfo[]>([]);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(true);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  // 移动端会话抽屉与列表过滤（T1/T6）
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
  // QQ 窗体：左栏折叠与全屏状态映射到标题栏控件
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 移动端任务设置默认折叠摘要；缺模型时强制展开，避免找不到配置
  const [isComposerSettingsOpen, setIsComposerSettingsOpen] = useState(true);
  const [sessionQuery, setSessionQuery] = useState("");
  // 最近发送的用户消息：供「重新生成」回填（T8）
  const lastUserMessageRef = useRef("");
  // 最近输入历史：供输入框 ↑↓ 浏览（T8 交互增强）
  const recentInputsRef = useRef<string[]>(
    (() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.recentInputs);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    })(),
  );
  // 错误恢复：保留最近一次失败输入以便重试（T7）
  const [lastFailedInput, setLastFailedInput] = useState("");
  // 会话列表摘要：本地缓存首条用户句，缓解多条「新会话」同质
  const [sessionPreviews, setSessionPreviews] = useState<Record<string, string>>({});
  // 新建会话首条消息：等拿到 sessionId 后再 PATCH 默认标题
  const pendingAutoTitleRef = useRef<string | null>(null);
  // 每个会话最多自动标题一次，避免后续消息改写
  const autoTitleAttemptedRef = useRef<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentSessionIdRef = useRef("");
  const shouldLoadSessionRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>("idle");
  const workspaceSelectionVersionRef = useRef(0);
  // 按会话缓存消息，避免串会话 / 切换后丢失流式结果
  const messagesBySessionRef = useRef<Record<string, ChatMessage[]>>({});
  // 当前 SSE 归属的会话键（新建时先为 pending）
  const streamSessionKeyRef = useRef<string>(PENDING_SESSION_KEY);
  const pendingLocalUserIdRef = useRef<string | null>(null);
  // 会话历史加载代数：快速切换时丢弃过期响应，避免 loading/内容来回闪
  const historyLoadVersionRef = useRef(0);
  // 移动抽屉 a11y：焦点陷阱与关闭后归还焦点
  const sessionDrawerPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const lastSentModelRef = useRef("");
  const modelOptionsRef = useRef<string[]>([]);
  const modelNameRef = useRef("");
  const isRunning = connectionState === "running";
  const highlightedSessionId = openingSessionId || sessionId;
  const isSessionSwitching = Boolean(openingSessionId) || isLoadingHistory;

  const applyModelName = useCallback((value: string, manual?: boolean) => {
    const nextValue = value.trim();
    modelNameRef.current = nextValue;
    setModelName(nextValue);
    setIsManualModel(manual ?? !modelOptionsRef.current.includes(nextValue));
  }, []);


  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const storedSessionId = localStorage.getItem(STORAGE_KEYS.sessionId) ?? "";
    if (storedSessionId) {
      shouldLoadSessionRef.current = true;
      currentSessionIdRef.current = storedSessionId;
      setSessionId(storedSessionId);
    }
    const storedModelName = localStorage.getItem(STORAGE_KEYS.modelName) ?? "";
    lastSentModelRef.current = storedModelName;
    applyModelName(storedModelName);
    setReasoningEffort(
      localStorage.getItem(STORAGE_KEYS.reasoningEffort) ?? "",
    );
    setSessionPreviews(readSessionPreviewMap());
  }, [applyModelName]);

  useEffect(() => {
    currentSessionIdRef.current = sessionId;
    saveLocalValue(STORAGE_KEYS.sessionId, sessionId);
  }, [sessionId]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    let cancelled = false;
    const loadModelOptions = async () => {
      try {
        const response = await fetch("/api/model/list", { cache: "no-store" });
        const options = (await readApiData<string[]>(response)) ?? [];
        if (cancelled) return;
        modelOptionsRef.current = options;
        setModelOptions(options);
        setModelOptionsError("");
        const nextModelName = modelNameRef.current || lastSentModelRef.current || options[0] || "";
        applyModelName(nextModelName, !nextModelName || !options.includes(nextModelName));
      } catch (error) {
        if (!cancelled) {
          setModelOptionsError(toErrorMessage(error));
          setIsManualModel(true);
        }
      } finally {
        if (!cancelled) setIsLoadingModelOptions(false);
      }
    };
    void loadModelOptions();
    return () => {
      cancelled = true;
    };
  }, [applyModelName]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveLocalValue(STORAGE_KEYS.reasoningEffort, reasoningEffort);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [reasoningEffort]);

  // 流式 delta 按帧合并，降低 setState 频率（optimize）
  const pendingDeltasRef = useRef<
    Map<string, { sessionKey: string; messageId: string; text: string; event: SessionEvent }>
  >(new Map());
  const deltaRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (deltaRafRef.current !== null) {
        window.cancelAnimationFrame(deltaRafRef.current);
      }
    };
  }, []);

  // 抽屉：锁背景滚动 + 初始焦点 + Tab 陷阱 + 关闭归还焦点（harden）
  useEffect(() => {
    if (!isSessionDrawerOpen) {
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = sessionDrawerPanelRef.current;
    const getFocusable = () => {
      if (!panel) {
        return [] as HTMLElement[];
      }
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1);
    };

    // 步骤：聚焦面板内第一个可聚焦控件（通常是关闭或新会话）
    const focusables = getFocusable();
    // 关闭按钮文案为「关闭会话列表」，不能用精确等于「关闭」
    const preferred =
      focusables.find((el) => (el.getAttribute("aria-label") || "").includes("关闭")) ||
      focusables[0];
    window.requestAnimationFrame(() => preferred?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
      const items = getFocusable();
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    panel?.addEventListener("keydown", onKeyDown);
    return () => {
      panel?.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      const restore = previousFocusRef.current || sessionMenuButtonRef.current;
      restore?.focus?.();
    };
  }, [isSessionDrawerOpen]);

  const rememberSessionPreview = useCallback((targetSessionId: string, rawText: string) => {
    const preview = compactPreviewText(rawText);
    if (!targetSessionId || !preview) {
      return;
    }
    setSessionPreviews((current) => {
      if (current[targetSessionId] === preview) {
        return current;
      }
      const next = { ...current, [targetSessionId]: preview };
      saveSessionPreviewMap(next);
      return next;
    });
  }, []);

  // 仅当服务端仍是默认「新会话」时用首条用户句写标题，不覆盖人工重命名
  const maybeAutoTitleSession = useCallback(
    async (targetSessionId: string, rawText: string, existingTitle?: string | null) => {
      const currentTitle = (existingTitle || "").trim();
      if (!targetSessionId || (currentTitle && currentTitle !== "新会话")) {
        return;
      }
      if (autoTitleAttemptedRef.current.has(targetSessionId)) {
        return;
      }
      const nextTitle = compactSessionTitle(rawText);
      if (!nextTitle) {
        return;
      }
      autoTitleAttemptedRef.current.add(targetSessionId);

      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(targetSessionId)}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ title: nextTitle }),
          },
        );
        const updated = await readApiData<SessionInfo>(response);
        if (!updated) {
          return;
        }
        setSessions((current) =>
          current.map((session) => (session.id === targetSessionId ? updated : session)),
        );
      } catch {
        // 自动标题失败不打断对话主路径
      }
    },
    [],
  );

  // 新会话：流里回写 id 后补标题
  useEffect(() => {
    const pending = pendingAutoTitleRef.current;
    if (!sessionId || !pending) {
      return;
    }
    pendingAutoTitleRef.current = null;
    void maybeAutoTitleSession(sessionId, pending, "新会话");
  }, [maybeAutoTitleSession, sessionId]);

  const isViewingSessionKey = useCallback((sessionKey: string) => {
    const current = currentSessionIdRef.current;
    if (!current) {
      return (
        sessionKey === PENDING_SESSION_KEY ||
        sessionKey === streamSessionKeyRef.current
      );
    }
    return sessionKey === current;
  }, []);

  const commitSessionMessages = useCallback(
    (sessionKey: string, updater: (current: ChatMessage[]) => ChatMessage[]) => {
      if (!sessionKey) {
        return;
      }
      const current = messagesBySessionRef.current[sessionKey] ?? [];
      const next = updater(current);
      messagesBySessionRef.current[sessionKey] = next;
      if (isViewingSessionKey(sessionKey)) {
        setMessages(next);
      }
    },
    [isViewingSessionKey],
  );

  const bindStreamSessionId = useCallback((nextSessionId: string) => {
    if (!nextSessionId) {
      return;
    }

    const previousKey = streamSessionKeyRef.current;
    if (previousKey === PENDING_SESSION_KEY) {
      const pendingMessages = messagesBySessionRef.current[PENDING_SESSION_KEY] ?? [];
      if (pendingMessages.length > 0) {
        const existing = messagesBySessionRef.current[nextSessionId] ?? [];
        messagesBySessionRef.current[nextSessionId] = existing.length
          ? mergeMessagesById(existing, pendingMessages)
          : pendingMessages;
      }
      delete messagesBySessionRef.current[PENDING_SESSION_KEY];
    }

    streamSessionKeyRef.current = nextSessionId;

    if (!currentSessionIdRef.current) {
      currentSessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
      setMessages(messagesBySessionRef.current[nextSessionId] ?? []);
    }

    setSessionPreviews((current) => {
      const pending = current[PENDING_SESSION_KEY];
      if (!pending) {
        return current;
      }
      const next = { ...current };
      delete next[PENDING_SESSION_KEY];
      next[nextSessionId] = pending;
      saveSessionPreviewMap(next);
      return next;
    });
  }, []);

  const addSystemMessage = useCallback(
    (text: string, state: MessageState = "info", sessionKey?: string) => {
      const targetKey =
        sessionKey ||
        currentSessionIdRef.current ||
        streamSessionKeyRef.current ||
        PENDING_SESSION_KEY;
      commitSessionMessages(targetKey, (current) => [
        ...current,
        {
          id: createLocalId("system"),
          role: "system",
          text,
          state,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    [commitSessionMessages],
  );

  const upsertMessage = useCallback(
    (sessionKey: string, message: ChatMessage) => {
      commitSessionMessages(sessionKey, (current) => {
        const index = current.findIndex((item) => item.id === message.id);
        if (index < 0) {
          return [...current, message];
        }
        const next = [...current];
        next[index] = { ...next[index], ...message };
        return next;
      });
    },
    [commitSessionMessages],
  );

  const applyAssistantDeltaNow = useCallback(
    (sessionKey: string, messageId: string, text: string, event: SessionEvent) => {
      if (!text) {
        return;
      }
      commitSessionMessages(sessionKey, (current) => {
        const index = current.findIndex((message) => message.id === messageId);

        if (index < 0) {
          const created = withAssistantDerivedFields({
            id: messageId,
            role: "assistant",
            text: "",
            state: "streaming",
            turnId: event.turnId,
            createdAt: event.createdAt,
            parts: appendAssistantTextPart(undefined, text, messageId),
          });
          return [...current, created];
        }

        const next = [...current];
        const existing = next[index];
        if (
          existing.state === "complete" ||
          existing.state === "cancel" ||
          existing.state === "error"
        ) {
          return current;
        }
        next[index] = withAssistantDerivedFields({
          ...existing,
          state: "streaming",
          turnId: event.turnId,
          createdAt: existing.createdAt || event.createdAt,
          parts: appendAssistantTextPart(existing.parts, text, messageId),
        });
        return next;
      });
    },
    [commitSessionMessages],
  );

  const drainPendingAssistantDeltas = useCallback(() => {
    if (pendingDeltasRef.current.size === 0) {
      return;
    }
    const batches = Array.from(pendingDeltasRef.current.values());
    pendingDeltasRef.current.clear();
    for (const batch of batches) {
      applyAssistantDeltaNow(batch.sessionKey, batch.messageId, batch.text, batch.event);
    }
  }, [applyAssistantDeltaNow]);

  const flushPendingAssistantDeltas = useCallback(() => {
    if (deltaRafRef.current != null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    drainPendingAssistantDeltas();
  }, [drainPendingAssistantDeltas]);

  // 设计决策：同帧多 delta 合并成一次 React 提交，长流式时主线程更稳
  const appendAssistantDelta = useCallback(
    (sessionKey: string, messageId: string, text: string, event: SessionEvent) => {
      if (!text) {
        return;
      }
      const key = `${sessionKey}::${messageId}`;
      const existing = pendingDeltasRef.current.get(key);
      if (existing) {
        existing.text += text;
        existing.event = event;
      } else {
        pendingDeltasRef.current.set(key, { sessionKey, messageId, text, event });
      }
      if (deltaRafRef.current != null) {
        return;
      }
      deltaRafRef.current = requestAnimationFrame(() => {
        deltaRafRef.current = null;
        drainPendingAssistantDeltas();
      });
    },
    [drainPendingAssistantDeltas],
  );

  const dropPendingAssistantDelta = useCallback((sessionKey: string, messageId: string) => {
    pendingDeltasRef.current.delete(`${sessionKey}::${messageId}`);
  }, []);

  useEffect(() => {
    return () => {
      if (deltaRafRef.current != null) {
        cancelAnimationFrame(deltaRafRef.current);
        deltaRafRef.current = null;
      }
      pendingDeltasRef.current.clear();
    };
  }, []);

  const upsertToolCall = useCallback(
    (sessionKey: string, event: ToolCallEvent) => {
      const toolCall = toToolCallView(event);
      const messageId =
        event.payload.messageId ||
        (event.turnId ? `assistant_${event.turnId}` : event.eventId);

      commitSessionMessages(sessionKey, (current) => {
        const index = current.findIndex((message) => message.id === messageId);

        if (index < 0) {
          return [
            ...current,
            withAssistantDerivedFields({
              id: messageId,
              role: "assistant",
              text: "",
              state: "streaming",
              turnId: event.turnId,
              createdAt: event.createdAt,
              parts: upsertAssistantToolPart(undefined, toolCall),
            }),
          ];
        }

        const next = [...current];
        const existing = next[index];
        next[index] = withAssistantDerivedFields({
          ...existing,
          state: existing.state ?? "streaming",
          turnId: existing.turnId || event.turnId,
          createdAt: existing.createdAt || event.createdAt,
          parts: upsertAssistantToolPart(existing.parts, toolCall),
        });
        return next;
      });
    },
    [commitSessionMessages],
  );

  // 对接后端工具权限审批：提交决策并回写工具状态
  const resolveToolApproval = useCallback(
    async (toolCall: ToolCallView, decision: ToolApprovalDecision) => {
      const approvalId = toolCall.approvalId;
      const targetSessionId = currentSessionIdRef.current;
      if (!approvalId || !targetSessionId) {
        return;
      }

      const updateToolCall = (status: ToolCallStatus, errorMessage = "") => {
        commitSessionMessages(targetSessionId, (current) =>
          current.map((message) => {
            if (!message.parts?.some((part) => part.type === "tool" && part.toolCall.id === toolCall.id) &&
              !message.toolCalls?.some((item) => item.id === toolCall.id)) {
              return message;
            }
            const nextParts = (message.parts ?? toolCallsToParts(message.toolCalls)).map((part) => {
              if (part.type !== "tool" || part.toolCall.id !== toolCall.id) {
                return part;
              }
              return {
                ...part,
                toolCall: { ...part.toolCall, status, errorMessage },
              };
            });
            return withAssistantDerivedFields({
              ...message,
              parts: nextParts,
            });
          }),
        );
      };

      updateToolCall("submitting");
      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(targetSessionId)}/approvals/${encodeURIComponent(approvalId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        );
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
      } catch (error) {
        updateToolCall("waiting_approval", toErrorMessage(error));
      }
    },
    [commitSessionMessages],
  );

  const markStreamingMessagesCancelled = useCallback(
    (sessionKey: string, turnId: string | null) => {
      commitSessionMessages(sessionKey, (current) =>
        current.map((message) => {
          if (
            message.role === "assistant" &&
            message.state === "streaming" &&
            (!turnId || message.turnId === turnId)
          ) {
            return { ...message, state: "cancel" };
          }
          return message;
        }),
      );
    },
    [commitSessionMessages],
  );

  const preferredModelName = useCallback((sessionMessages?: ChatMessage[]) => {
    if (sessionMessages) {
      for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
        const message = sessionMessages[index];
        if (message.role === "user" && message.modelName?.trim()) return message.modelName.trim();
      }
    }
    return lastSentModelRef.current || modelOptionsRef.current[0] || "";
  }, []);

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      const eventSessionId = event.sessionId || "";

      if (eventSessionId) {
        bindStreamSessionId(eventSessionId);
      }

      // 事件始终写入所属会话，而不是只写入“当前正在看的会话”
      const targetKey =
        eventSessionId ||
        streamSessionKeyRef.current ||
        currentSessionIdRef.current ||
        PENDING_SESSION_KEY;

      if (event.turnId && isViewingSessionKey(targetKey)) {
        setActiveTurnId(event.turnId);
      }

      if (event.type !== "ERROR" && isViewingSessionKey(targetKey)) {
        setErrorMessage("");
      }

      if (event.type === "USER_MESSAGE") {
        const localUserId = pendingLocalUserIdRef.current;
        pendingLocalUserIdRef.current = null;
        commitSessionMessages(targetKey, (current) => {
          const withoutOptimistic = localUserId
            ? current.filter((message) => message.id !== localUserId)
            : current;
          const message: ChatMessage = {
            id: event.payload.messageId || event.eventId,
            role: "user",
            text: event.payload.text,
            turnId: event.turnId,
            createdAt: event.createdAt,
            modelName: event.payload.modelName,
          };
          const index = withoutOptimistic.findIndex((item) => item.id === message.id);
          if (index < 0) {
            return [...withoutOptimistic, message];
          }
          const next = [...withoutOptimistic];
          next[index] = { ...next[index], ...message };
          return next;
        });
        const sid = event.sessionId || (targetKey !== PENDING_SESSION_KEY ? targetKey : "");
        if (sid) {
          rememberSessionPreview(sid, event.payload.text || "");
        }
        return;
      }

      if (event.type === "ASSISTANT_MESSAGE_DELTA") {
        const messageId = event.payload.messageId || event.eventId;
        appendAssistantDelta(targetKey, messageId, event.payload.text || "", event);
        return;
      }

      if (isToolCallEvent(event)) {
        flushPendingAssistantDeltas();
        upsertToolCall(targetKey, event);
        return;
      }

      if (event.type === "ASSISTANT_MESSAGE") {
        // 完整消息以服务端文本为准；保留已按事件序排好的 tool parts
        const messageId = event.payload.messageId || event.eventId;
        dropPendingAssistantDelta(targetKey, messageId);
        flushPendingAssistantDeltas();
        commitSessionMessages(targetKey, (current) => {
          const index = current.findIndex((item) => item.id === messageId);
          const finalText = event.payload.text || "";
          if (index < 0) {
            return [
              ...current,
              withAssistantDerivedFields({
                id: messageId,
                role: "assistant",
                text: "",
                state: event.payload.state,
                turnId: event.turnId,
                createdAt: event.createdAt,
                parts: applyFinalAssistantText(undefined, finalText, messageId),
              }),
            ];
          }
          const next = [...current];
          const existing = next[index];
          next[index] = withAssistantDerivedFields({
            ...existing,
            state: event.payload.state,
            turnId: existing.turnId || event.turnId,
            createdAt: existing.createdAt || event.createdAt,
            parts: applyFinalAssistantText(existing.parts, finalText, messageId),
          });
          return next;
        });
        if (!isViewingSessionKey(targetKey)) {
          return;
        }
        if (event.payload.state === "complete") {
          setConnectionState("idle");
          setActiveTurnId(null);
        } else if (event.payload.state === "cancel") {
          setConnectionState("idle");
          setActiveTurnId(null);
        } else if (event.payload.state === "error") {
          setConnectionState("error");
          setErrorMessage(event.payload.errorMessage || "本轮会话执行失败");
          setActiveTurnId(null);
        }
        return;
      }

      if (event.type === "CANCELLED") {
        markStreamingMessagesCancelled(targetKey, event.turnId);
        if (isViewingSessionKey(targetKey)) {
          setConnectionState("idle");
          setActiveTurnId(null);
          addSystemMessage("本轮会话已取消", "info", targetKey);
        }
        return;
      }

      if (event.type === "ERROR") {
        const message = event.payload.errorMessage || "本轮会话执行失败";
        if (isViewingSessionKey(targetKey)) {
          setConnectionState("error");
          setErrorMessage(message);
          setActiveTurnId(null);
        }
        addSystemMessage(message, "error", targetKey);
      }
    },
    [
      addSystemMessage,
      appendAssistantDelta,
      dropPendingAssistantDelta,
      flushPendingAssistantDeltas,
      bindStreamSessionId,
      commitSessionMessages,
      isViewingSessionKey,
      markStreamingMessagesCancelled,
      rememberSessionPreview,
      upsertMessage,
      upsertToolCall,
    ],
  );

  const clearCurrentSession = useCallback(() => {
    pendingAutoTitleRef.current = null;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    workspaceSelectionVersionRef.current += 1;
    historyLoadVersionRef.current += 1;
    shouldLoadSessionRef.current = false;
    currentSessionIdRef.current = "";
    streamSessionKeyRef.current = PENDING_SESSION_KEY;
    pendingLocalUserIdRef.current = null;
    delete messagesBySessionRef.current[PENDING_SESSION_KEY];
    setMessages([]);
    setInput("");
    setSessionId("");
    setOpeningSessionId(null);
    setIsLoadingHistory(false);
    setErrorMessage("");
    setActiveTurnId(null);
    setEditingSessionId(null);
    setTitleDraft("");
    setViewingSessionStatus(null);
    setPendingWorkspacePath("");
    setWorkspaceMessage("");
    setIsSelectingWorkspace(false);
    setConnectionState("idle");
    applyModelName(preferredModelName());
    localStorage.removeItem(STORAGE_KEYS.sessionId);
  }, [applyModelName, preferredModelName]);

  const refreshSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const [activeResponse, archivedResponse] = await Promise.all([
        fetch("/api/session/list", { cache: "no-store" }),
        fetch("/api/session/list/archived", { cache: "no-store" }),
      ]);
      const activeData = await readApiData<SessionInfo[]>(activeResponse);
      const archivedData = await readApiData<SessionInfo[]>(archivedResponse);
      const nextActive = activeData ?? [];
      const nextArchived = archivedData ?? [];
      setSessions(nextActive);
      setArchivedSessions(nextArchived);
      setSessionListError("");
      setSessionMessage("");

      const currentId = currentSessionIdRef.current;
      if (!currentId) {
        setViewingSessionStatus(null);
        return;
      }

      const activeSession = nextActive.find((session) => session.id === currentId);
      if (activeSession) {
        setViewingSessionStatus("active");
        return;
      }

      const archivedSession = nextArchived.find(
        (session) => session.id === currentId,
      );
      if (archivedSession) {
        // 本地缓存恢复阶段遇到归档会话要清空；用户主动打开的只读会话可保留
        if (shouldLoadSessionRef.current) {
          clearCurrentSession();
          return;
        }
        setViewingSessionStatus("archived");
        return;
      }

      // 会话已被硬删除或不存在时，切回未选中。
      // 流式进行中列表可能短暂不一致，避免清空正在渲染的会话。
      if (connectionStateRef.current === "running") {
        return;
      }
      clearCurrentSession();
    } catch (error) {
      setSessionListError(humanizeSessionListError(error));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [clearCurrentSession]);

  const refreshWorkspaces = useCallback(async () => {
    setIsLoadingWorkspaces(true);
    try {
      const response = await fetch("/api/workspace/list", { cache: "no-store" });
      const data = await readApiData<FeatureWorkspaceInfo[]>(response);
      setWorkspaces(data ?? []);
      setWorkspaceError("");
    } catch (error) {
      setWorkspaceError(toErrorMessage(error));
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, []);

  const loadSessionEvents = useCallback(async (
    nextSessionId: string,
    options?: { quiet?: boolean; status?: SessionStatus },
  ) => {
    if (!nextSessionId) {
      return;
    }

    // fetch-first：先拉数据，成功后再一次提交视图；quiet 用于有缓存时的后台对齐
    const quiet = options?.quiet === true;
    const loadVersion = ++historyLoadVersionRef.current;

    if (!quiet) {
      setIsLoadingHistory(true);
      setOpeningSessionId((current) => current ?? nextSessionId);
    }

    try {
      // 并行拉详情+事件：详情补齐 workspace/status，避免仅依赖列表缓存
      const [detailResponse, eventsResponse] = await Promise.all([
        fetch(`/api/session/${encodeURIComponent(nextSessionId)}`, {
          cache: "no-store",
        }),
        fetch(`/api/session/${encodeURIComponent(nextSessionId)}/events`, {
          cache: "no-store",
        }),
      ]);
      const detail = await readApiData<SessionInfo>(detailResponse);
      const events = await readApiData<SessionEvent[]>(eventsResponse);

      // 用户已切走：丢弃过期结果，防止旧 loading/内容回跳
      if (loadVersion !== historyLoadVersionRef.current) {
        return;
      }

      let nextStatus = options?.status;
      if (detail) {
        const normalized = normalizeSessionInfo(detail);
        nextStatus = nextStatus ?? normalized.status;
        if (normalized.status === "active") {
          setSessions((current) => upsertSession(current, normalized));
          setArchivedSessions((current) =>
            current.filter((session) => session.id !== normalized.id),
          );
        } else {
          setArchivedSessions((current) => upsertSession(current, normalized));
          setSessions((current) =>
            current.filter((session) => session.id !== normalized.id),
          );
        }
      }

      const streamingThisSession =
        connectionStateRef.current === "running" &&
        streamSessionKeyRef.current === nextSessionId;
      const historyMessages = reduceSessionEventsToMessages(events ?? []);

      // 一次提交视图状态：避免“清空 → 加载态 → 内容”多次重置消息滚动槽。
      currentSessionIdRef.current = nextSessionId;
      if (!streamingThisSession) {
        streamSessionKeyRef.current = nextSessionId;
        messagesBySessionRef.current[nextSessionId] = historyMessages;
        setMessages(historyMessages);
      } else if (!quiet) {
        setMessages(messagesBySessionRef.current[nextSessionId] ?? historyMessages);
      }
      if (!quiet) applyModelName(preferredModelName(historyMessages));
      setSessionId(nextSessionId);
      if (nextStatus) {
        setViewingSessionStatus(nextStatus);
      }

      const firstUser = historyMessages.find((item) => item.role === "user" && item.text.trim());
      if (firstUser) {
        rememberSessionPreview(nextSessionId, firstUser.text);
      }

      // quiet 后台对齐只更新消息/元数据，不打断输入区
      if (!quiet) {
        setInput("");
        setErrorMessage("");
        setSessionMessage("");
        setEditingSessionId(null);
        setConnectionState((current) => (current === "running" ? current : "idle"));
        if (connectionStateRef.current !== "running") {
          setActiveTurnId(null);
        }
      }
    } catch (error) {
      if (loadVersion !== historyLoadVersionRef.current) {
        return;
      }
      // 失败时保留当前画面，不把线程清空成 loading/空壳
      setSessionMessage(toErrorMessage(error));
    } finally {
      if (loadVersion === historyLoadVersionRef.current) {
        setIsLoadingHistory(false);
        setOpeningSessionId((current) => (current === nextSessionId ? null : current));
      }
    }
  }, [applyModelName, preferredModelName, rememberSessionPreview]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    if (!sessionId || !shouldLoadSessionRef.current || isLoadingSessions) {
      return;
    }

    const isActive = sessions.some((session) => session.id === sessionId);
    if (!isActive) {
      // 本地缓存会话已归档或不存在时，不回显，直接清空
      shouldLoadSessionRef.current = false;
      if (sessionId) {
        clearCurrentSession();
      }
      return;
    }

    shouldLoadSessionRef.current = false;
    setViewingSessionStatus("active");
    void loadSessionEvents(sessionId);
  }, [
    clearCurrentSession,
    isLoadingSessions,
    loadSessionEvents,
    sessionId,
    sessions,
  ]);

  const openSession = useCallback(
    async (nextSessionId: string, status?: SessionStatus) => {
      if (!nextSessionId) {
        return;
      }
      if (
        nextSessionId === currentSessionIdRef.current &&
        !openingSessionId &&
        (!status || status === viewingSessionStatus)
      ) {
        return;
      }

      shouldLoadSessionRef.current = false;
      workspaceSelectionVersionRef.current += 1;
      setPendingWorkspacePath("");
      setWorkspaceMessage("");
      setIsSelectingWorkspace(false);
      setIsSessionDrawerOpen(false);
      setSessionMessage("");
      setEditingSessionId(null);

      // 该会话正在流式输出：直接展示本地流式缓存，避免历史快照盖掉未落盘 delta
      if (
        connectionStateRef.current === "running" &&
        streamSessionKeyRef.current === nextSessionId
      ) {
        historyLoadVersionRef.current += 1;
        currentSessionIdRef.current = nextSessionId;
        setSessionId(nextSessionId);
        const streamingMessages = messagesBySessionRef.current[nextSessionId] ?? [];
        setMessages(streamingMessages);
        applyModelName(preferredModelName(streamingMessages));
        if (status) {
          setViewingSessionStatus(status);
        }
        setOpeningSessionId(null);
        setIsLoadingHistory(false);
        setInput("");
        return;
      }

      const cached = messagesBySessionRef.current[nextSessionId];
      if (cached && cached.length > 0) {
        // 本地已有数据：一次提交后静默对齐，不先卸主线程
        historyLoadVersionRef.current += 1;
        currentSessionIdRef.current = nextSessionId;
        streamSessionKeyRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setMessages(cached);
        applyModelName(preferredModelName(cached));
        if (status) {
          setViewingSessionStatus(status);
        }
        setOpeningSessionId(null);
        setIsLoadingHistory(false);
        setInput("");
        setErrorMessage("");
        await loadSessionEvents(nextSessionId, { quiet: true, status });
        return;
      }

      // 无缓存：保持当前会话画面，等接口返回后再一次切换
      setOpeningSessionId(nextSessionId);
      await loadSessionEvents(nextSessionId, { quiet: false, status });
    },
    [applyModelName, loadSessionEvents, openingSessionId, preferredModelName, viewingSessionStatus],
  );

  const beginRenameSession = useCallback((session: SessionInfo) => {
    setEditingSessionId(session.id);
    setTitleDraft(session.title || "新会话");
    setSessionMessage("");
  }, []);

  const submitRenameSession = useCallback(async () => {
    const targetSessionId = editingSessionId;
    const title = titleDraft.trim();
    if (!targetSessionId) {
      return;
    }
    if (!title) {
      setSessionMessage("会话标题不能为空");
      return;
    }

    try {
      const response = await fetch(
        `/api/session/${encodeURIComponent(targetSessionId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title }),
        },
      );
      const updated = await readApiData<SessionInfo>(response);
      setSessions((current) =>
        current.map((session) =>
          session.id === targetSessionId ? (updated ?? session) : session,
        ),
      );
      setEditingSessionId(null);
      setTitleDraft("");
      setSessionMessage("");
    } catch (error) {
      setSessionMessage(toErrorMessage(error));
    }
  }, [editingSessionId, titleDraft]);

  const archiveSession = useCallback(
    async (target: SessionInfo) => {
      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(target.id)}/archive`,
          { method: "POST" },
        );
        await readApiData<SessionInfo>(response);
        if (currentSessionIdRef.current === target.id) {
          clearCurrentSession();
        }
        setSessionMessage("");
        await refreshSessions();
      } catch (error) {
        setSessionMessage(toErrorMessage(error));
      }
    },
    [clearCurrentSession, refreshSessions],
  );

  const unarchiveSession = useCallback(
    async (target: SessionInfo) => {
      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(target.id)}/unarchive`,
          { method: "POST" },
        );
        await readApiData<SessionInfo>(response);
        if (currentSessionIdRef.current === target.id) {
          setViewingSessionStatus("active");
        }
        setSessionMessage("");
        await refreshSessions();
      } catch (error) {
        setSessionMessage(toErrorMessage(error));
      }
    },
    [refreshSessions],
  );

  // 仅归档会话可删（后端约束）；清理本地预览避免搜索脏数据
  const deleteSession = useCallback(
    async (target: SessionInfo) => {
      const title = sessionListTitle(target, sessionPreviews[target.id]);

      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(target.id)}`,
          { method: "DELETE" },
        );
        await readApiData<void>(response);
        // 删掉的是当前会话：回到未选中
        if (currentSessionIdRef.current === target.id) {
          clearCurrentSession();
        }
        // 清理本地列表摘要
        setSessionPreviews((current) => {
          if (!(target.id in current)) {
            return current;
          }
          const next = { ...current };
          delete next[target.id];
          saveSessionPreviewMap(next);
          return next;
        });
        setSessionMessage("");
        await refreshSessions();
      } catch (error) {
        setSessionMessage(toErrorMessage(error));
      }
    },
    [clearCurrentSession, refreshSessions, sessionPreviews],
  );

  const selectWorkspace = useCallback(async () => {
    if (currentSessionIdRef.current || isSelectingWorkspace || isRunning) {
      return;
    }

    const requestVersion = workspaceSelectionVersionRef.current + 1;
    workspaceSelectionVersionRef.current = requestVersion;
    setIsSelectingWorkspace(true);
    setWorkspaceMessage("");

    try {
      const response = await fetch("/api/workspace/select-directory", {
        method: "POST",
        cache: "no-store",
      });
      const result = await readApiData<WorkspaceSelectResp>(response);
      if (workspaceSelectionVersionRef.current !== requestVersion || currentSessionIdRef.current) {
        return;
      }
      if (result?.workspacePath) {
        setPendingWorkspacePath(result.workspacePath);
      }
    } catch (error) {
      if (workspaceSelectionVersionRef.current === requestVersion) {
        setWorkspaceMessage(toErrorMessage(error));
      }
    } finally {
      if (workspaceSelectionVersionRef.current === requestVersion) {
        setIsSelectingWorkspace(false);
      }
    }
  }, [isRunning, isSelectingWorkspace]);

  const selectSavedWorkspace = useCallback((workspace: FeatureWorkspaceInfo) => {
    if (currentSessionIdRef.current || isSelectingWorkspace || isRunning) {
      return;
    }
    workspaceSelectionVersionRef.current += 1;
    setPendingWorkspacePath(workspace.path);
    setWorkspaceMessage(`已选择工作区：${workspace.name}`);
  }, [isRunning, isSelectingWorkspace]);

  const saveWorkspace = useCallback(async () => {
    const path = pendingWorkspacePath.trim();
    if (!path || currentSessionIdRef.current || isSavingWorkspace) {
      return;
    }
    setIsSavingWorkspace(true);
    setWorkspaceMessage("");
    try {
      const response = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const saved = await readApiData<FeatureWorkspaceInfo>(response);
      if (saved) {
        setWorkspaces((current) => upsertWorkspace(current, saved));
        setWorkspaceMessage(`工作区“${saved.name}”已保存`);
      }
    } catch (error) {
      setWorkspaceMessage(toErrorMessage(error));
    } finally {
      setIsSavingWorkspace(false);
    }
  }, [isSavingWorkspace, pendingWorkspacePath]);

  const deleteWorkspace = useCallback(async (workspace: FeatureWorkspaceInfo) => {
    if (deletingWorkspaceId) {
      return;
    }
    setDeletingWorkspaceId(workspace.id);
    setWorkspaceMessage("");
    try {
      const response = await fetch(`/api/workspace/${encodeURIComponent(workspace.id)}`, {
        method: "DELETE",
      });
      await readApiData<{ deletedSessionCount: number }>(response);
      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id));
      if (pendingWorkspacePath === workspace.path) {
        setPendingWorkspacePath("");
      }
      const currentSessionBelongsToWorkspace = [...sessions, ...archivedSessions].some(
        (session) => session.id === currentSessionIdRef.current && session.workspaceId === workspace.id,
      );
      if (currentSessionBelongsToWorkspace) {
        clearCurrentSession();
      }
      setWorkspaceMessage(`工作区“${workspace.name}”已移除，磁盘目录未删除`);
      await refreshSessions();
    } catch (error) {
      setWorkspaceMessage(toErrorMessage(error));
    } finally {
      setDeletingWorkspaceId(null);
    }
  }, [archivedSessions, clearCurrentSession, deletingWorkspaceId, pendingWorkspacePath, refreshSessions, sessions]);

  const clearPendingWorkspace = useCallback(() => {
    if (currentSessionIdRef.current || isSelectingWorkspace) {
      return;
    }
    workspaceSelectionVersionRef.current += 1;
    setPendingWorkspacePath("");
    setWorkspaceMessage("");
  }, [isSelectingWorkspace]);

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      const userMessage = input.trim();
      const selectedModelName = modelName.trim();

      if (!userMessage || isRunning || isSessionSwitching || isSelectingWorkspace) {
        return;
      }

      if (!selectedModelName) {
        const message = "请先填写模型名称";
        setConnectionState("error");
        setErrorMessage(message);
        window.requestAnimationFrame(() => {
          document.getElementById("model-input")?.focus();
        });
        return;
      }

      const controller = new AbortController();
      lastSentModelRef.current = selectedModelName;
      saveLocalValue(STORAGE_KEYS.modelName, selectedModelName);
      applyModelName(selectedModelName);
      abortControllerRef.current = controller;
      setConnectionState("running");
      setErrorMessage("");
      setLastFailedInput("");
      setInput("");
      // 记录最近发送的用户消息：供「重新生成」操作回填（T8）
      lastUserMessageRef.current = userMessage;
      // 记录最近输入历史（供输入框 ↑↓ 浏览），最新在前、去重、限 5 条
      recentInputsRef.current = [
        userMessage,
        ...recentInputsRef.current.filter((item) => item !== userMessage),
      ].slice(0, RECENT_INPUT_LIMIT);
      try {
        localStorage.setItem(STORAGE_KEYS.recentInputs, JSON.stringify(recentInputsRef.current));
      } catch {
        // 忽略本地存储失败，不影响发送
      }
      const streamKey = sessionId || PENDING_SESSION_KEY;
      streamSessionKeyRef.current = streamKey;
      // 列表扫视：有 session 直接记；新建会话先挂 pending，等事件回写 id
      if (sessionId) {
        rememberSessionPreview(sessionId, userMessage);
        const existingTitle =
          sessions.find((session) => session.id === sessionId)?.title ??
          archivedSessions.find((session) => session.id === sessionId)?.title;
        void maybeAutoTitleSession(sessionId, userMessage, existingTitle);
      } else {
        pendingAutoTitleRef.current = userMessage;
        rememberSessionPreview(PENDING_SESSION_KEY, userMessage);
      }

      // 乐观插入用户消息，避免等首个 SSE 才出现内容
      const localUserId = createLocalId("local_user");
      pendingLocalUserIdRef.current = localUserId;
      commitSessionMessages(streamKey, (current) => [
        ...current,
        {
          id: localUserId,
          role: "user",
          text: userMessage,
          createdAt: new Date().toISOString(),
          modelName: selectedModelName,
        },
      ]);

      const body: ChatReq = {
        modelName: selectedModelName,
        reasoningEffort: reasoningEffort.trim(),
        userMessage,
        workspacePath: sessionId ? "" : pendingWorkspacePath,
        sessionId,
      };

      try {
        const response = await fetch("/api/session/chat", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }

        await readSessionEventStream(
          response,
          (sessionEvent) => {
            if (
              abortControllerRef.current !== controller ||
              controller.signal.aborted
            ) {
              return;
            }
            handleSessionEvent(sessionEvent);
          },
          {
            // 同一 TCP 分片内多条 DELTA 同步处理时 React 会批成一次渲染；按帧让出以保留打字机
            paceWithAnimationFrame: true,
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message = toErrorMessage(error);
        setConnectionState("error");
        setErrorMessage(message);
        setLastFailedInput(userMessage);
        setInput((current) => current || userMessage);
        addSystemMessage(message, "error");
      } finally {
        void refreshSessions();
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          setActiveTurnId(null);
          setConnectionState((current) =>
            current === "running" ? "idle" : current,
          );
        }
      }
    },
    [
      addSystemMessage,
      applyModelName,
      archivedSessions,
      commitSessionMessages,
      handleSessionEvent,
      input,
      isLoadingHistory,
      isRunning,
      isSelectingWorkspace,
      maybeAutoTitleSession,
      modelName,
      pendingWorkspacePath,
      reasoningEffort,
      refreshSessions,
      rememberSessionPreview,
      sessionId,
      sessions,
    ],
  );

  const stopCurrentRun = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    const sessionKey =
      currentSessionIdRef.current || streamSessionKeyRef.current || "";
    handleSessionEvent({
      eventId: createLocalId("cancelled"),
      sessionId: sessionKey === PENDING_SESSION_KEY ? "" : sessionKey,
      turnId: activeTurnId,
      type: "CANCELLED",
      source: "USER",
      createdAt: new Date().toISOString(),
      payload: {},
      meta: { local: true },
    });
    void refreshSessions();
  }, [activeTurnId, handleSessionEvent, refreshSessions]);

  const startNewSession = useCallback(() => {
    clearCurrentSession();
    setSessionMessage("");
    setSessionListTab("active");
    setIsSessionDrawerOpen(false);
    void refreshSessions();
  }, [clearCurrentSession, refreshSessions]);

  // 快捷键：Esc 关抽屉或停止；⌘/Ctrl+Enter 发送（T6）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isSessionDrawerOpen) {
          setIsSessionDrawerOpen(false);
          return;
        }
        if (connectionStateRef.current === "running") {
          event.preventDefault();
          stopCurrentRun();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
          event.preventDefault();
          void sendMessage();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSessionDrawerOpen, sendMessage, stopCurrentRun]);

  const status = useMemo(
    () => getStatusView(connectionState, activeTurnId),
    [activeTurnId, connectionState],
  );
  const currentSession = useMemo(() => {
    if (!sessionId) {
      return null;
    }
    return (
      sessions.find((session) => session.id === sessionId) ??
      archivedSessions.find((session) => session.id === sessionId) ??
      null
    );
  }, [archivedSessions, sessionId, sessions]);
  const persistedWorkspacePath = currentSession?.workspacePath ?? "";
  const displayedWorkspacePath = persistedWorkspacePath || pendingWorkspacePath;
  const workspaceStatusText = displayedWorkspacePath || (sessionId ? (currentSession ? "未设置工作区" : "工作区加载中") : "使用默认工作区");
  const isArchivedView =
    viewingSessionStatus === "archived" ||
    currentSession?.status === "archived";

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((left, right) => sessionActivityTime(right) - sessionActivityTime(left))
        .slice(0, 3),
    [sessions],
  );

  const workspaceSessionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const session of [...sessions, ...archivedSessions]) {
      if (session.workspaceId) {
        counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1;
      }
    }
    return counts;
  }, [archivedSessions, sessions]);

  // 可操作授权请求：仅当前实时会话中仍带 approvalId 的项
  const pendingApprovalTools = useMemo(() => {
    const tools: ToolCallView[] = [];
    for (const message of messages) {
      for (const tool of collectMessageToolCalls(message)) {
        if (
          tool.approvalId &&
          (tool.status === "waiting_approval" || tool.status === "submitting")
        ) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }, [messages]);

  const pendingApprovalCount = pendingApprovalTools.length;

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
    } catch {
      setSessionMessage("浏览器未允许切换全屏");
    }
  }, []);

  const resetWindowLayout = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // 退出全屏失败时仍恢复应用内布局
    }
    setIsSidebarCollapsed(false);
    setIsSessionDrawerOpen(false);
  }, []);

  const focusModelInput = useCallback(() => {
    setIsComposerSettingsOpen(true);
    requestAnimationFrame(() => {
      const input = document.getElementById("model-input");
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      input.focus();
      input.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);

  // 列表：最近活跃优先，选中会话仅高亮不置顶；搜索含标题/摘要/路径/ID
  const visibleSessions = useMemo(() => {
    const source =
      sessionListTab === "active" ? sessions : archivedSessions;
    const query = sessionQuery.trim().toLowerCase();
    const filtered = source.filter((session) => {
      if (!query) {
        return true;
      }
      const title = sessionListTitle(session, sessionPreviews[session.id]).toLowerCase();
      const preview = (sessionPreviews[session.id] || "").toLowerCase();
      const path = (session.workspacePath || "").toLowerCase();
      return (
        title.includes(query) ||
        preview.includes(query) ||
        path.includes(query) ||
        session.id.toLowerCase().includes(query)
      );
    });

    filtered.sort((left, right) => sessionActivityTime(right) - sessionActivityTime(left));

    return filtered;
  }, [
    archivedSessions,
    sessionId,
    sessionListTab,
    sessionPreviews,
    sessionQuery,
    sessions,
  ]);

  // 运行中最近工具（T3）
  const activeTool = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const tools = collectMessageToolCalls(messages[index]);
      if (!tools.length) continue;
      const reversed = [...tools].reverse();
      const pending = reversed.find(
        (tool) => tool.status === "waiting_approval" || tool.status === "submitting",
      );
      if (pending) return pending;
      const running = reversed.find((tool) => tool.status === "started");
      if (running) return running;
      return tools[tools.length - 1];
    }
    return null;
  }, [messages]);

  const copyError = useCallback(async () => {
    if (!errorMessage) return;
    try {
      await navigator.clipboard.writeText(errorMessage);
      setSessionMessage("错误信息已复制");
    } catch {
      setSessionMessage("复制失败，请手动选择文本");
    }
  }, [errorMessage]);

  const retryLastInput = useCallback(() => {
    if (!lastFailedInput.trim()) return;
    setInput(lastFailedInput);
    setErrorMessage("");
    setConnectionState("idle");
  }, [lastFailedInput]);

  const renderSessionList = (options?: { onAfterSelect?: () => void }) => (
    <SessionListPanel
      visibleSessions={visibleSessions as FeatureSessionInfo[]}
      workspaces={workspaces}
      workspaceSessionCounts={workspaceSessionCounts}
      sessionPreviews={sessionPreviews}
      highlightedSessionId={highlightedSessionId}
      sessionListTab={sessionListTab as FeatureSessionListTab}
      sessionQuery={sessionQuery}
      isLoadingSessions={isLoadingSessions}
      sessionListError={sessionListError}
      sessionMessage={workspaceMessage || sessionMessage}
      isRunning={isRunning}
      isSelectingWorkspace={isSelectingWorkspace}
      isLoadingWorkspaces={isLoadingWorkspaces}
      isSavingWorkspace={isSavingWorkspace}
      deletingWorkspaceId={deletingWorkspaceId}
      workspaceError={workspaceError}
      pendingWorkspacePath={pendingWorkspacePath}
      isSessionSwitching={isSessionSwitching}
      isCurrentSessionRunning={isRunning && sessionId === highlightedSessionId}
      editingSessionId={editingSessionId}
      titleDraft={titleDraft}
      confirmingAction={confirmingAction as SessionConfirmAction}
      onQueryChange={setSessionQuery}
      onCreateSession={startNewSession}
      onRefreshWorkspaces={() => void refreshWorkspaces()}
      onSelectWorkspace={selectSavedWorkspace}
      onSaveWorkspace={() => void saveWorkspace()}
      onDeleteWorkspace={(workspace) => void deleteWorkspace(workspace)}
      onRefresh={() => void refreshSessions()}
      onTabChange={(tab) => {
        setSessionListTab(tab);
        setEditingSessionId(null);
        setTitleDraft("");
      }}
      onOpenSession={(session) => {
        void openSession(session.id, sessionListTab === "archived" ? "archived" : "active");
        options?.onAfterSelect?.();
      }}
      onBeginRename={beginRenameSession}
      onTitleDraftChange={setTitleDraft}
      onSubmitRename={() => void submitRenameSession()}
      onCancelRename={() => {
        setEditingSessionId(null);
        setTitleDraft("");
      }}
      onArchive={(session) => void archiveSession(session)}
      onUnarchive={(session) => void unarchiveSession(session)}
      onDelete={(session) => void deleteSession(session)}
      onConfirmActionChange={setConfirmingAction}
    />
  );

  const desktopSidebarVisible = !isSidebarCollapsed;

  return (
    <main className="relative h-dvh overflow-hidden bg-[#e8e8e8] p-0 text-text-1 [overscroll-behavior:none]">
      <div className={layoutStyles.shell}>
        <WorkbenchHeader
          status={status}
          isSidebarCollapsed={isSidebarCollapsed}
          isFullscreen={isFullscreen}
          onToggleSidebar={() => setIsSidebarCollapsed((current) => !current)}
          onToggleFullscreen={() => void toggleFullscreen()}
          onResetLayout={() => void resetWindowLayout()}
        />

        <div
          className={`${layoutStyles.grid} ${
            desktopSidebarVisible ? layoutStyles.gridSidebarVisible : layoutStyles.gridSidebarCollapsed
          }`}
        >
          {/* 桌面侧栏：联系人式会话索引 */}
          {desktopSidebarVisible ? (
            <aside className={`${sidebarStyles.sidebar} hidden min-h-0 min-[900px]:flex min-[900px]:flex-col`}>
              <div className={sidebarStyles.profile}>
                <span aria-hidden className={sidebarStyles.profileAvatar}>
                  M
                </span>
                <div className="min-w-0">
                  <p className={sidebarStyles.profileName}>Mboo Code</p>
                  <p className={sidebarStyles.profileStatus}>
                    <span className={sidebarStyles.onlineDot} aria-hidden />
                    本地代理在线
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-text-3" title={modelName || "未选择模型"}>
                    {modelName.trim() || "未选择模型"}
                    {reasoningEffort ? ` · ${reasoningEffort}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
                {renderSessionList()}
              </div>
            </aside>
          ) : null}

          {/* 移动端会话抽屉 */}
          {isSessionDrawerOpen ? (
            <div className="fixed inset-0 z-40 min-[900px]:hidden" role="presentation">
              <button
                aria-label="关闭会话列表"
                className="absolute inset-0 bg-text-1/35"
                type="button"
                onClick={() => setIsSessionDrawerOpen(false)}
              />
              <div
                ref={sessionDrawerPanelRef}
                role="dialog"
                aria-modal="true"
                aria-label="会话列表"
                className={`${sidebarStyles.sidebar} absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] max-w-[100vw] flex-col pt-[env(safe-area-inset-top)] shadow-dock`}
              >
                <div className={`${sidebarStyles.profile} justify-between gap-2 pr-2`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className={sidebarStyles.profileAvatar}>
                      M
                    </span>
                    <div className="min-w-0">
                      <p className={sidebarStyles.profileName}>会话</p>
                      <p className={sidebarStyles.profileStatus}>
                        <span className={sidebarStyles.onlineDot} aria-hidden />
                        选择或管理任务
                      </p>
                    </div>
                  </div>
                  <button
                    aria-label="关闭会话列表"
                    className={sidebarStyles.closeButton}
                    type="button"
                    onClick={() => setIsSessionDrawerOpen(false)}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
                  {renderSessionList({ onAfterSelect: () => setIsSessionDrawerOpen(false) })}
                </div>
              </div>
            </div>
          ) : null}

          <section className={layoutStyles.mainSurface}>
            <ConversationStatusPanel
              title={currentSession?.title || (sessionId ? "当前会话" : "新任务")}
              archived={isArchivedView}
              status={status}
              errorMessage={errorMessage}
              hasRetryInput={Boolean(lastFailedInput)}
              sessionMenuButtonRef={sessionMenuButtonRef}
              isSessionDrawerOpen={isSessionDrawerOpen}
              onOpenSessionDrawer={() => setIsSessionDrawerOpen(true)}
              onCopyError={() => void copyError()}
              onRetryInput={retryLastInput}
              onClearError={() => {
                setErrorMessage("");
                setConnectionState("idle");
              }}
            />

            <div className={layoutStyles.threadHost}>
              {/* 空态与消息态共享同一个线程宿主，避免切会话时重置垂直布局。 */}
              {messages.length === 0 ? (
                <div className={layoutStyles.threadScroller}>
                  {isSessionSwitching ? (
                    <ConversationLoadingState />
                  ) : (
                    <div className="mx-auto max-w-[46rem] rounded-[var(--radius-md)] border border-line bg-panel px-4 py-5 shadow-panel sm:px-5 sm:py-6">
                      {/* 设计决策：缺模型只在输入器保留一个主阻断；空态只给下一步与示例 */}
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="mboo-avatar-m size-12 rounded-[12px] border border-line text-xl">
                          M
                        </span>
                        <div className="min-w-0">
                          <p className="text-base font-semibold text-text-1">等待新的任务指令</p>
                          <p className="mt-1 text-xs leading-5 text-text-3">
                            {modelName.trim()
                              ? "在下方输入目标并发送即可开始"
                              : "下一步：在下方任务设置填写模型"}
                          </p>
                        </div>
                      </div>

                      {modelName.trim() ? (
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          <span className="rounded-[3px] border border-ok/30 bg-ok-soft px-2 py-1 text-[11px] text-ok">
                            模型 · {modelName.trim()}
                          </span>
                          <span className="rounded-[3px] border border-line bg-panel-elevated px-2 py-1 font-mono text-[11px] text-text-2">
                            工作区 ·{" "}
                            {displayedWorkspacePath
                              ? workspaceBasename(displayedWorkspacePath)
                              : sessionId
                                ? "未设置路径"
                                : "使用默认"}
                          </span>
                        </div>
                      ) : null}

                      <div className="mt-5 border-t border-line pt-4">
                        <p className="text-xs font-medium text-text-3">快速填入示例</p>
                        <ul className="mt-2 space-y-1">
                          {["梳理代码结构", "定位构建失败", "补一版接口说明"].map((hint) => (
                            <li key={hint}>
                              <button
                                className="min-h-11 w-full rounded-[var(--radius-sm)] px-2 py-2.5 text-left text-sm text-text-2 hover:bg-panel-muted hover:text-text-1 sm:min-h-0 sm:py-2"
                                type="button"
                                onClick={() => {
                                  setInput(hint);
                                  if (!modelName.trim()) {
                                    focusModelInput();
                                  }
                                }}
                              >
                                {hint}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <MessageList
                  sessionId={sessionId || PENDING_SESSION_KEY}
                  messages={messages}
                  isRunning={isRunning}
                  activityMessage={
                    activeTool
                      ? `工具：${getToolLabel(activeTool.toolName)}${
                          activeTool.status === "waiting_approval"
                            ? "（等待授权）"
                            : activeTool.status === "submitting"
                              ? "（处理授权）"
                              : activeTool.status === "started"
                                ? "（执行中）"
                                : ""
                        }`
                      : activeTurnId
                        ? "正在处理"
                        : "正在连接"
                  }
                  onStop={stopCurrentRun}
                  readToolResult={async (targetSessionId, resultId) => {
                    const response = await fetch(
                      `/api/session/${encodeURIComponent(targetSessionId)}/tool-results/${encodeURIComponent(resultId)}`,
                      { cache: "no-store" },
                    );
                    return readApiData<ToolResultDetail>(response);
                  }}
                  toErrorMessage={toErrorMessage}
                  onRegenerate={() => {
                    // 重新生成：回填最近发送的用户消息并聚焦（T8 消息操作栏）
                    setInput(lastUserMessageRef.current);
                    window.requestAnimationFrame(() => {
                      document.getElementById("task-input")?.focus();
                    });
                  }}
                  onContinue={() => {
                    // 继续：聚焦输入框让用户接着追问
                    window.requestAnimationFrame(() => {
                      document.getElementById("task-input")?.focus();
                    });
                  }}
                />
              )}
              {isSessionSwitching && messages.length > 0 ? (
                <div
                  className="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-[3px] border border-line bg-panel/95 px-2 py-1 text-[11px] text-text-3 shadow-panel"
                  role="status"
                  aria-live="polite"
                >
                  <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden />
                  同步会话
                </div>
              ) : null}
            </div>

            <div className={`${layoutStyles.composerDock} px-3 sm:px-4 min-[1440px]:px-0`}>
              {isArchivedView ? (
                <div className="mx-auto max-w-[46rem] rounded-[var(--radius-sm)] border border-running/30 bg-running-soft px-4 py-3 text-sm text-running">
                  当前为归档会话，仅支持回看。可在会话列表中取消归档后继续对话。
                </div>
              ) : (
                <>
                  {pendingApprovalTools.length > 0 ? (
                    <div className={`${layoutStyles.approvalStack} mx-auto mb-2 w-full max-w-[46rem] space-y-2`}>
                      {pendingApprovalTools.map((toolCall) => (
                        <ToolApprovalCard
                          key={toolCall.approvalId || toolCall.id}
                          toolCall={toolCall}
                          onResolveApproval={resolveToolApproval}
                        />
                      ))}
                    </div>
                  ) : null}
                <TaskComposer
                  input={input}
                  onInputChange={setInput}
                  recentInputs={recentInputsRef.current}
                  isRunning={isRunning}
                  isSessionSwitching={isSessionSwitching}
                  isSelectingWorkspace={isSelectingWorkspace}
                  modelName={modelName}
                  isManualModel={isManualModel}
                  onModelChange={applyModelName}
                  modelOptions={modelOptions}
                  modelOptionsError={modelOptionsError}
                  isLoadingModelOptions={isLoadingModelOptions}
                  reasoningEffort={reasoningEffort}
                  onReasoningChange={setReasoningEffort}
                  workspacePath={displayedWorkspacePath}
                  workspaceStatusText={workspaceStatusText}
                  canSelectWorkspace={!sessionId && !isSessionSwitching && !isArchivedView}
                  canClearWorkspace={Boolean(!sessionId && displayedWorkspacePath)}
                  onSelectWorkspace={() => void selectWorkspace()}
                  onClearWorkspace={clearPendingWorkspace}
                  isComposerSettingsOpen={isComposerSettingsOpen}
                  onToggleSettings={() => setIsComposerSettingsOpen((current) => !current)}
                  onSend={sendMessage}
                  onStop={stopCurrentRun}
                  onFocusModelInput={focusModelInput}
                />
                </>
              )}
            </div>
          </section>

          <ContextRail
            modelName={modelName}
            workspacePath={displayedWorkspacePath}
            workspaceStatusText={workspaceStatusText}
            recentSessions={recentSessions}
            sessionPreviews={sessionPreviews}
            sessionId={highlightedSessionId}
            pendingApprovalCount={pendingApprovalCount}
            errorMessage={errorMessage}
            isRunning={isRunning}
            onOpenSession={(id) => void openSession(id, "active")}
          />
        </div>
      </div>
    </main>
  );
}

function getStatusView(state: ConnectionState, activeTurnId: string | null) {
  if (state === "running") {
    return {
      label: activeTurnId ? "运行中" : "连接中",
      className: "border-running/35 bg-running-soft text-running",
      running: true,
    };
  }
  if (state === "error") {
    return {
      label: "异常",
      className: "border-danger/35 bg-danger-soft text-danger",
      running: false,
    };
  }
  // 空闲用中性蓝灰，避免「空闲=成功」误读
  return {
    label: "空闲",
    className: "border-line bg-panel-elevated text-text-2",
    running: false,
  };
}

function payloadDisplayText(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseToolArguments(toolName: string, value: unknown) {
  const rawText = payloadDisplayText(value);
  if (!rawText) {
    return { argumentsText: "" };
  }

  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { argumentsText: rawText };
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { argumentsText: rawText };
  }

  const parsedArguments = sanitizeToolArguments(toolName, parsed as Record<string, unknown>);
  return {
    argumentsText: JSON.stringify(parsedArguments, null, 2),
    parsedArguments,
    pathText:
      FILE_TOOL_NAMES.has(toolName) && typeof parsedArguments.path === "string"
        ? parsedArguments.path
        : toolName === "run_command" && typeof parsedArguments.workdir === "string"
          ? parsedArguments.workdir
          : toolName === "run_command"
            ? "."
            : undefined,
  };
}

function sanitizeToolArguments(toolName: string, argumentsObject: Record<string, unknown>) {
  if (toolName === "edit_file") {
    const { oldText, newText, ...safe } = argumentsObject;
    return {
      ...safe,
      oldTextLength:
        typeof safe.oldTextLength === "number"
          ? safe.oldTextLength
          : typeof oldText === "string"
            ? oldText.length
            : 0,
      newTextLength:
        typeof safe.newTextLength === "number"
          ? safe.newTextLength
          : typeof newText === "string"
            ? newText.length
            : 0,
    };
  }
  if (toolName === "write_file") {
    const { content, ...safe } = argumentsObject;
    return {
      ...safe,
      contentLength:
        typeof safe.contentLength === "number"
          ? safe.contentLength
          : typeof content === "string"
            ? content.length
            : 0,
    };
  }
  return argumentsObject;
}

function hasDiffContent(text: string) {
  return text.split("\n").some((line) => line.startsWith("@@") || line.startsWith("--- "));
}

function diffLineClassName(line: string) {
  if (line.includes("已截断，省略")) {
    return "bg-panel-elevated text-text-3";
  }
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    return "bg-running-soft text-running";
  }
  if (line.startsWith("@@")) {
    return "bg-running-soft/60 text-running";
  }
  if (line.startsWith("+")) {
    return "bg-ok/10 text-ok";
  }
  if (line.startsWith("-")) {
    return "bg-danger-soft text-danger";
  }
  return "text-text-2";
}

function collectMessageToolCalls(message: ChatMessage): ToolCallView[] {
  if (message.parts?.length) {
    return message.parts.filter((part): part is AssistantToolPart => part.type === "tool").map((part) => part.toolCall);
  }
  return message.toolCalls ?? [];
}

function toolCallsToParts(toolCalls?: ToolCallView[]): AssistantPart[] {
  return (toolCalls ?? []).map((toolCall) => ({
    type: "tool" as const,
    id: toolCall.id,
    toolCall,
  }));
}

function assistantPartsToText(parts?: AssistantPart[]): string {
  if (!parts?.length) {
    return "";
  }
  return parts
    .filter((part): part is AssistantTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function withAssistantDerivedFields(message: ChatMessage): ChatMessage {
  if (message.role !== "assistant") {
    return message;
  }
  const parts = message.parts;
  if (!parts) {
    return message;
  }
  return {
    ...message,
    text: assistantPartsToText(parts),
    toolCalls: parts
      .filter((part): part is AssistantToolPart => part.type === "tool")
      .map((part) => part.toolCall),
    parts,
  };
}

/** 文本 delta：若末尾已是 text part 则追加，否则在时间线末尾新开一段（可出现在 tool 之后） */
function appendAssistantTextPart(
  parts: AssistantPart[] | undefined,
  text: string,
  messageId: string,
): AssistantPart[] {
  if (!text) {
    return parts ?? [];
  }
  const current = parts ?? [];
  const last = current[current.length - 1];
  if (last?.type === "text") {
    return [
      ...current.slice(0, -1),
      {
        ...last,
        text: `${last.text}${text}`,
      },
    ];
  }
  return [
    ...current,
    {
      type: "text",
      id: `text_${messageId}_${current.length}`,
      text,
    },
  ];
}

/** 同一 toolCallId 只占一个 part，STARTED/ENDED/APPROVAL 原地更新 */
function upsertAssistantToolPart(
  parts: AssistantPart[] | undefined,
  toolCall: ToolCallView,
): AssistantPart[] {
  const current = parts ?? [];
  const index = current.findIndex(
    (part) => part.type === "tool" && part.toolCall.id === toolCall.id,
  );
  if (index < 0) {
    return [
      ...current,
      {
        type: "tool",
        id: toolCall.id,
        toolCall,
      },
    ];
  }
  const existing = current[index];
  if (existing.type !== "tool") {
    return current;
  }
  const next = current.slice();
  next[index] = {
    ...existing,
    toolCall: {
      ...existing.toolCall,
      ...toolCall,
      // 结束事件可能不带 approval 字段，避免把进行中的授权元数据抹掉
      approvalId: toolCall.approvalId ?? existing.toolCall.approvalId,
      approvalTitle: toolCall.approvalTitle ?? existing.toolCall.approvalTitle,
      approvalDescription:
        toolCall.approvalDescription ?? existing.toolCall.approvalDescription,
      permissionType: toolCall.permissionType ?? existing.toolCall.permissionType,
      grantPath: toolCall.grantPath ?? existing.toolCall.grantPath,
      approvalIndex: toolCall.approvalIndex ?? existing.toolCall.approvalIndex,
      approvalCount: toolCall.approvalCount ?? existing.toolCall.approvalCount,
    },
  };
  return next;
}

/**
 * 最终 ASSISTANT_MESSAGE：
 * - 已有交错 parts 时保留 tool 位置，不把全文再追加一份
 * - 只有 tool、尚无 text 时，把最终文本接在 tool 后
 * - 完全没有 parts 时，退化为单段 text
 */
function applyFinalAssistantText(
  parts: AssistantPart[] | undefined,
  finalText: string,
  messageId: string,
): AssistantPart[] {
  const current = parts ?? [];
  const hasTool = current.some((part) => part.type === "tool");
  const hasText = current.some((part) => part.type === "text");

  // 空消息：整段终稿作为唯一 text part
  if (!hasTool && !hasText) {
    return finalText
      ? [
          {
            type: "text",
            id: `text_${messageId}_0`,
            text: finalText,
          },
        ]
      : [];
  }

  // 已有文本时间线（来自 delta）：必须保留 tool/text 交错，不能用终稿重排
  if (hasText) {
    if (!hasTool && finalText) {
      // 纯文本助手消息：终稿覆盖，避免 delta 与终稿微差
      return [
        {
          type: "text",
          id: `text_${messageId}_0`,
          text: finalText,
        },
      ];
    }
    return current;
  }

  // 仅有 tool（常见于历史未落 delta）：正文接在工具之后
  return finalText
    ? [
        ...current,
        {
          type: "text",
          id: `text_${messageId}_${current.length}`,
          text: finalText,
        },
      ]
    : current;
}

function isToolCallEvent(event: SessionEvent): event is ToolCallEvent {
  return (
    event.type === "TOOL_CALL_STARTED" ||
    event.type === "TOOL_CALL_ENDED" ||
    event.type === "TOOL_APPROVAL_REQUIRED"
  );
}

function toToolCallView(event: ToolCallEvent): ToolCallView {
  const { payload } = event;
  const toolName = payload.toolName || "unknown_tool";
  const parsed = parseToolArguments(toolName, payload.arguments);

  if (event.type === "TOOL_APPROVAL_REQUIRED") {
    return {
      id: payload.toolCallId || event.eventId,
      turnId: event.turnId,
      toolName,
      status: "waiting_approval",
      argumentsText: parsed.argumentsText,
      parsedArguments: parsed.parsedArguments,
      pathText: parsed.pathText,
      errorMessage: "",
      createdAt: event.createdAt,
      approvalId: event.payload.approvalId,
      approvalTitle: event.payload.title,
      approvalDescription: event.payload.description,
      permissionType: event.payload.permissionType || "TOOL",
      grantPath: event.payload.grantPath || undefined,
      approvalIndex: event.payload.approvalIndex,
      approvalCount: event.payload.approvalCount,
    };
  }

  const started = event.type === "TOOL_CALL_STARTED";
  return {
    id: payload.toolCallId || event.eventId,
    turnId: event.turnId,
    toolName,
    status: started ? "started" : event.payload.status,
    argumentsText: parsed.argumentsText,
    parsedArguments: parsed.parsedArguments,
    pathText: parsed.pathText,
    resultId: started ? undefined : event.payload.resultId,
    resultSizeBytes: started ? undefined : event.payload.resultSizeBytes,
    rawOutputAvailable: started ? undefined : event.payload.rawOutputAvailable,
    errorCode: started ? undefined : event.payload.errorCode || undefined,
    errorMessage: started ? "" : event.payload.errorMessage || "",
    durationMs: started ? undefined : event.payload.durationMs,
    createdAt: event.createdAt,
  };
}

function getToolLabel(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName;
}

function sessionAllowLabel(permissionType?: ToolPermissionType) {
  if (permissionType === "READ") {
    return "本会话允许读取此目录";
  }
  if (permissionType === "WRITE") {
    return "本会话允许读写此目录";
  }
  if (permissionType === "COMMAND") {
    return "本会话允许此命令";
  }
  return "本会话始终允许此工具";
}

function reduceSessionEventsToMessages(events: SessionEvent[]) {
  const seenEventIds = new Set<string>();
  let messages: ChatMessage[] = [];

  for (const event of events) {
    if (seenEventIds.has(event.eventId)) {
      continue;
    }
    seenEventIds.add(event.eventId);

    if (event.type === "USER_MESSAGE") {
      messages = upsertMessageSnapshot(messages, {
        id: event.payload.messageId || event.eventId,
        role: "user",
        text: event.payload.text,
        turnId: event.turnId,
        createdAt: event.createdAt,
        modelName: event.payload.modelName,
      });
      continue;
    }

    if (event.type === "ASSISTANT_MESSAGE_DELTA") {
      const messageId = event.payload.messageId || event.eventId;
      const delta = event.payload.text || "";
      if (!delta) {
        continue;
      }
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) {
        messages = [
          ...messages,
          withAssistantDerivedFields({
            id: messageId,
            role: "assistant",
            text: "",
            state: "streaming",
            turnId: event.turnId,
            createdAt: event.createdAt,
            parts: appendAssistantTextPart(undefined, delta, messageId),
          }),
        ];
      } else {
        const existing = messages[index];
        const next = messages.slice();
        next[index] = withAssistantDerivedFields({
          ...existing,
          state: existing.state === "complete" || existing.state === "cancel" || existing.state === "error"
            ? existing.state
            : "streaming",
          turnId: existing.turnId || event.turnId,
          createdAt: existing.createdAt || event.createdAt,
          parts: appendAssistantTextPart(existing.parts, delta, messageId),
        });
        messages = next;
      }
      continue;
    }

    if (isToolCallEvent(event)) {
      messages = upsertToolCallSnapshot(messages, event);
      continue;
    }

    if (event.type === "ASSISTANT_MESSAGE") {
      const messageId = event.payload.messageId || event.eventId;
      const finalText = event.payload.text || "";
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) {
        messages = upsertMessageSnapshot(
          messages,
          withAssistantDerivedFields({
            id: messageId,
            role: "assistant",
            text: "",
            state: event.payload.state,
            turnId: event.turnId,
            createdAt: event.createdAt,
            parts: applyFinalAssistantText(undefined, finalText, messageId),
          }),
        );
      } else {
        const next = messages.slice();
        const existing = next[index];
        next[index] = withAssistantDerivedFields({
          ...existing,
          state: event.payload.state,
          turnId: existing.turnId || event.turnId,
          createdAt: existing.createdAt || event.createdAt,
          parts: applyFinalAssistantText(existing.parts, finalText, messageId),
        });
        messages = next;
      }
      continue;
    }

    if (event.type === "ERROR") {
      messages = [
        ...messages,
        {
          id: `system_${event.eventId}`,
          role: "system",
          text: event.payload.errorMessage || "本轮会话执行失败",
          state: "error",
          turnId: event.turnId,
          createdAt: event.createdAt,
        },
      ];
      continue;
    }

    if (event.type === "CANCELLED") {
      if (event.turnId) {
        messages = messages.map((message) =>
          message.role === "assistant" && message.turnId === event.turnId
            ? { ...message, state: "cancel" }
            : message,
        );
      }
      messages = [
        ...messages,
        {
          id: `system_${event.eventId}`,
          role: "system",
          text: "本轮会话已取消",
          state: "info",
          turnId: event.turnId,
          createdAt: event.createdAt,
        },
      ];
    }
  }

  // 历史回放中尚未结束的授权卡片已失效，禁止再次点击
  return messages.map((message) => {
    const invalidate = (toolCall: ToolCallView): ToolCallView =>
      toolCall.status === "waiting_approval" || toolCall.status === "submitting"
        ? {
            ...toolCall,
            status: "failed" as const,
            errorMessage: toolCall.errorMessage || "授权请求已失效",
            approvalId: undefined,
          }
        : toolCall;

    if (!message.parts?.length && !message.toolCalls?.length) {
      return message;
    }
    const parts = (message.parts ?? toolCallsToParts(message.toolCalls)).map((part) =>
      part.type === "tool" ? { ...part, toolCall: invalidate(part.toolCall) } : part,
    );
    return withAssistantDerivedFields({
      ...message,
      parts,
    });
  });
}

function upsertMessageSnapshot(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) {
    if (message.role === "assistant" && message.turnId) {
      const systemMessageIndex = messages.findIndex((item) => item.role === "system" && item.turnId === message.turnId);
      if (systemMessageIndex >= 0) {
        return [...messages.slice(0, systemMessageIndex), message, ...messages.slice(systemMessageIndex)];
      }
    }
    return [...messages, message];
  }

  const next = [...messages];
  next[index] = { ...next[index], ...message };
  return next;
}

function upsertToolCallSnapshot(
  messages: ChatMessage[],
  event: ToolCallEvent,
): ChatMessage[] {
  const toolCall = toToolCallView(event);
  const messageId =
    event.payload.messageId ||
    (event.turnId ? `assistant_${event.turnId}` : event.eventId);
  const index = messages.findIndex((message) => message.id === messageId);

  if (index < 0) {
    return [
      ...messages,
      withAssistantDerivedFields({
        id: messageId,
        role: "assistant" as const,
        text: "",
        state: "streaming" as const,
        turnId: event.turnId,
        createdAt: event.createdAt,
        parts: upsertAssistantToolPart(undefined, toolCall),
      }),
    ];
  }

  const next = [...messages];
  const existing = next[index];
  next[index] = withAssistantDerivedFields({
    ...existing,
    state: existing.state ?? "streaming",
    turnId: existing.turnId || event.turnId,
    createdAt: existing.createdAt || event.createdAt,
    parts: upsertAssistantToolPart(existing.parts, toolCall),
  });
  return next;
}

function mergeMessagesById(base: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map<string, ChatMessage>();
  for (const message of base) {
    map.set(message.id, message);
  }
  for (const message of incoming) {
    const existing = map.get(message.id);
    map.set(message.id, existing ? { ...existing, ...message } : message);
  }
  return Array.from(map.values());
}

function normalizeSessionInfo(session: SessionInfo): SessionInfo {
  const status: SessionStatus =
    session.status === "archived" ? "archived" : "active";
  return {
    ...session,
    status,
  };
}

function upsertSession(list: SessionInfo[], session: SessionInfo) {
  const index = list.findIndex((item) => item.id === session.id);
  if (index < 0) {
    return [session, ...list];
  }
  const next = list.slice();
  next[index] = {
    ...next[index],
    ...session,
  };
  return next;
}

function upsertWorkspace(list: FeatureWorkspaceInfo[], workspace: FeatureWorkspaceInfo) {
  const index = list.findIndex((item) => item.id === workspace.id);
  if (index < 0) {
    return [workspace, ...list];
  }
  const next = list.slice();
  next[index] = workspace;
  return next;
}

async function readApiData<T>(response: Response) {
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return undefined as T;
  }

  let body: ApiResponse<T>;
  try {
    body = JSON.parse(text) as ApiResponse<T>;
  } catch {
    throw new Error(text.trim());
  }

  if (body.success === false) {
    throw new Error(body.msg || body.message || body.exception || "请求失败");
  }

  if ("data" in body) {
    return body.data as T;
  }

  return body as T;
}

async function readErrorMessage(response: Response) {
  // 保留状态码作兜底；列表层再 humanize 成人话
  const fallback = `请求失败（${response.status}）`;
  const text = await response.text().catch(() => "");

  if (!text.trim()) {
    return fallback;
  }

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const message = data.message || data.msg || data.error || data.exception;
    return typeof message === "string" && message.trim()
      ? message
      : text.trim();
  } catch {
    return text.trim();
  }
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "会话请求失败";
}

// 列表失败文案：把 HTTP 码翻译成可行动的人话
function humanizeSessionListError(error: unknown) {
  const message = toErrorMessage(error);
  const lower = message.toLowerCase();
  if (
    message.includes("请求失败（500）") ||
    message.includes("请求失败（502）") ||
    message.includes("请求失败（503）") ||
    message.includes("请求失败（504）") ||
    /50[0-4]/.test(message)
  ) {
    return "无法加载会话列表：后端暂时不可用";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("load failed") ||
    message.includes("网络")
  ) {
    return "无法连接会话服务，请确认后端已启动";
  }
  if (message.includes("请求失败（404）") || /404/.test(message)) {
    return "会话接口不存在，请检查前后端代理配置";
  }
  if (message.startsWith("无法")) {
    return message;
  }
  return `无法加载会话列表：${message}`;
}

function saveLocalValue(key: string, value: string) {
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

function createLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readSessionPreviewMap(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sessionPreviews);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function saveSessionPreviewMap(map: Record<string, string>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEYS.sessionPreviews, JSON.stringify(map));
  } catch {
    // 忽略配额等本地存储失败
  }
}

function compactPreviewText(raw: string) {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > 36 ? `${normalized.slice(0, 36)}…` : normalized;
}

// 默认会话标题：比列表摘要略长，仍单行可读；后端上限 80
function compactSessionTitle(raw: string) {
  const normalized = raw.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > 40 ? `${normalized.slice(0, 40)}…` : normalized;
}

function sessionListTitle(session: SessionInfo, preview?: string) {
  const title = (session.title || "").trim();
  if (title && title !== "新会话") {
    return title;
  }
  if (preview?.trim()) {
    return preview.trim();
  }
  return title || "新会话";
}

function sessionActivityTime(session: SessionInfo) {
  const raw =
    session.status === "archived"
      ? session.archivedAt || session.updatedAt || session.createdAt
      : session.updatedAt || session.createdAt;
  if (!raw) {
    return 0;
  }
  const time = Date.parse(raw);
  return Number.isNaN(time) ? 0 : time;
}

function workspaceBasename(path?: string | null) {
  if (!path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}
