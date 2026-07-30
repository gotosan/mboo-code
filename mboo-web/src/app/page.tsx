"use client";

import type { FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  LoaderCircle,
  Menu,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import AssistantMarkdown from "@/components/assistant-markdown";
import { readSessionEventStream } from "@/lib/session-stream";
import type {
  AssistantMessageState,
  ChatReq,
  SessionEvent,
  ToolApprovalDecision,
  ToolCallStatus,
  ToolPermissionType,
} from "@/lib/session-types";

const STORAGE_KEYS = {
  sessionId: "mboo-web.sessionId",
  modelName: "mboo-web.modelName",
  reasoningEffort: "mboo-web.reasoningEffort",
  sessionPreviews: "mboo-web.sessionPreviews",
};

const DEFAULT_MODEL = process.env.NEXT_PUBLIC_MBOO_DEFAULT_MODEL ?? "";

const REASONING_OPTIONS = [
  { value: "", label: "默认" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const TOOL_LABELS: Record<string, string> = {
  glob_files: "查找文件",
  search_text: "搜索文本",
  read_file: "读取文件",
  edit_file: "编辑文件",
  write_file: "写入文件",
  run_command: "执行命令",
  getWeather: "查询天气",
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

/** 距底部小于该值视为贴底，用于流式跟随与“回到底部”按钮 */
const NEAR_BOTTOM_PX = 120;

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
  resultPreview: string;
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
  const [modelName, setModelName] = useState(DEFAULT_MODEL);
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
  const [viewingSessionStatus, setViewingSessionStatus] =
    useState<SessionStatus | null>(null);
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
  const isRunning = connectionState === "running";
  const highlightedSessionId = openingSessionId || sessionId;
  const isSessionSwitching = Boolean(openingSessionId) || isLoadingHistory;


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
    setModelName(localStorage.getItem(STORAGE_KEYS.modelName) ?? DEFAULT_MODEL);
    setReasoningEffort(
      localStorage.getItem(STORAGE_KEYS.reasoningEffort) ?? "",
    );
    setSessionPreviews(readSessionPreviewMap());
  }, []);

  useEffect(() => {
    currentSessionIdRef.current = sessionId;
    saveLocalValue(STORAGE_KEYS.sessionId, sessionId);
  }, [sessionId]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  // 设计决策：输入中防抖写 localStorage，避免每个按键同步磁盘（optimize）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveLocalValue(STORAGE_KEYS.modelName, modelName);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [modelName]);

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
    localStorage.removeItem(STORAGE_KEYS.sessionId);
  }, []);

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

      // 一次提交视图状态：避免“清空 → loading 壳 → 内容”多次挂载 qq-thread
      currentSessionIdRef.current = nextSessionId;
      if (!streamingThisSession) {
        streamSessionKeyRef.current = nextSessionId;
        messagesBySessionRef.current[nextSessionId] = historyMessages;
        setMessages(historyMessages);
      } else if (!quiet) {
        setMessages(messagesBySessionRef.current[nextSessionId] ?? historyMessages);
      }
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
  }, [rememberSessionPreview]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

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
        setMessages(messagesBySessionRef.current[nextSessionId] ?? []);
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
    [loadSessionEvents, openingSessionId, viewingSessionStatus],
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
      if (!window.confirm(`确认归档「${target.title || "新会话"}」？归档后仅可回看。`)) {
        return;
      }
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
      if (!window.confirm(`删除「${title}」后不可恢复，确认删除？`)) {
        return;
      }

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
      abortControllerRef.current = controller;
      setConnectionState("running");
      setErrorMessage("");
      setLastFailedInput("");
      setInput("");
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

  // 列表：最近活跃优先；当前选中置顶；搜索含标题/摘要/路径/ID
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

    if (sessionId) {
      const selectedIndex = filtered.findIndex((session) => session.id === sessionId);
      if (selectedIndex > 0) {
        const [selected] = filtered.splice(selectedIndex, 1);
        filtered.unshift(selected);
      }
    }

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
    <>
      <label className="qq-search-field mt-1">
        <span className="qq-icon qq-icon-search" aria-hidden />
        <span className="sr-only">过滤会话</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-3"
          placeholder="搜索会话"
          value={sessionQuery}
          onChange={(event) => setSessionQuery(event.target.value)}
        />
      </label>

      <div className="mt-2 flex items-center gap-1">
        <button
          className="qq-button-primary inline-flex h-11 flex-1 items-center justify-center gap-1 px-2 text-xs min-[900px]:h-8"
          disabled={isRunning || isSelectingWorkspace}
          type="button"
          onClick={startNewSession}
        >
          <span className="qq-icon qq-icon-new-task" aria-hidden />
          新会话
        </button>
        <button
          aria-label="刷新会话列表"
          className="qq-button inline-flex size-11 items-center justify-center text-text-2 min-[900px]:size-8"
          disabled={isLoadingSessions}
          type="button"
          onClick={() => void refreshSessions()}
        >
          <RefreshCw className={`size-3.5 ${isLoadingSessions ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] border border-line bg-panel-muted p-0.5" role="tablist" aria-label="会话分类">
        <button
          role="tab"
          aria-selected={sessionListTab === "active"}
          className={`h-9 rounded-[2px] text-xs font-medium min-[900px]:h-7 ${
            sessionListTab === "active" ? "qq-selected-row text-text-1" : "text-text-3 hover:text-text-1"
          }`}
          type="button"
          onClick={() => {
            setSessionListTab("active");
            setEditingSessionId(null);
            setTitleDraft("");
          }}
        >
          活跃
        </button>
        <button
          role="tab"
          aria-selected={sessionListTab === "archived"}
          className={`h-9 rounded-[2px] text-xs font-medium min-[900px]:h-7 ${
            sessionListTab === "archived" ? "qq-selected-row text-text-1" : "text-text-3 hover:text-text-1"
          }`}
          type="button"
          onClick={() => {
            setSessionListTab("archived");
            setEditingSessionId(null);
            setTitleDraft("");
          }}
        >
          归档
        </button>
      </div>

      {sessionListError ? (
        <div className="mt-2 rounded-[var(--radius-sm)] border border-danger/35 bg-danger-soft px-2.5 py-2" role="alert">
          <p className="text-xs font-medium leading-5 text-danger">{sessionListError}</p>
          <p className="mt-1 text-[11px] leading-5 text-text-3">仍可新建任务；历史会话恢复后会自动可用。</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              className="qq-button inline-flex h-7 items-center gap-1 px-2 text-[11px] text-danger"
              type="button"
              disabled={isLoadingSessions}
              onClick={() => void refreshSessions()}
            >
              <RefreshCw className={`size-3 ${isLoadingSessions ? "motion-safe:animate-spin" : ""}`} aria-hidden />
              重试
            </button>
            <button
              className="qq-button-primary inline-flex h-7 items-center gap-1 px-2 text-[11px]"
              type="button"
              disabled={isRunning || isSelectingWorkspace}
              onClick={startNewSession}
            >
              新建任务
            </button>
          </div>
        </div>
      ) : null}

      {sessionMessage ? (
        <p className="mt-2 rounded-[var(--radius-sm)] border border-danger/30 bg-danger-soft px-2.5 py-2 text-xs leading-5 text-danger" role="status">
          {sessionMessage}
        </p>
      ) : null}

      <div className="qq-group-header mt-3 flex items-center gap-1 px-1 py-1">
        {sessionListTab === "active" ? (
          <ChevronDown className="size-3.5" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden />
        )}
        <span>
          {sessionListTab === "active" ? "正在进行" : "已归档"}（{visibleSessions.length}）
        </span>
      </div>

      <div className="qq-scrollbar console-scroll mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
        {isLoadingSessions ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-line px-3 py-8 text-center text-sm text-text-3">
            正在加载会话
          </div>
        ) : sessionListError ? (
          // 设计决策：失败原因只在上方 alert 讲一次，列表区不再双写警报
          <div className="rounded-[var(--radius-sm)] border border-dashed border-line px-3 py-6 text-center text-xs text-text-3">
            列表暂时为空。可先新建任务，或使用上方重试。
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-line px-3 py-8 text-center">
            <p className="text-sm text-text-2">
              {sessionQuery.trim()
                ? "没有匹配的会话"
                : sessionListTab === "active"
                  ? "暂无活跃会话"
                  : "暂无归档会话"}
            </p>
            <p className="mt-1 text-xs text-text-3">
              {sessionQuery.trim() ? "试试其他关键词" : "从新会话开始一次任务"}
            </p>
          </div>
        ) : (
          visibleSessions.map((session) => {
            const selected = session.id === highlightedSessionId;
            const editing = editingSessionId === session.id;
            const isArchivedItem = sessionListTab === "archived";

            return (
              <div
                key={session.id}
                className={`session-item group min-h-[46px] rounded-[var(--radius-sm)] px-1.5 py-1.5 ${
                  selected ? "qq-selected-row" : "qq-session-row"
                }`}
              >
                {editing && !isArchivedItem ? (
                  <div className="space-y-1.5">
                    <label className="block">
                      <span className="sr-only">会话标题</span>
                      <input
                        className="qq-input h-10 w-full px-2 text-sm text-text-1 outline-none min-[900px]:h-8"
                        maxLength={80}
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                    </label>
                    <div className="flex gap-1">
                      <button
                        className="qq-button-primary h-10 flex-1 text-xs min-[900px]:h-7"
                        type="button"
                        onClick={() => void submitRenameSession()}
                      >
                        保存
                      </button>
                      <button
                        className="qq-button h-10 flex-1 text-xs text-text-2 min-[900px]:h-7"
                        type="button"
                        onClick={() => {
                          setEditingSessionId(null);
                          setTitleDraft("");
                        }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      className="flex w-full min-w-0 items-start gap-2 text-left focus-visible:outline-none"
                      disabled={isSessionSwitching || isSelectingWorkspace}
                      type="button"
                      onClick={() => {
                        void openSession(session.id, isArchivedItem ? "archived" : "active");
                        options?.onAfterSelect?.();
                      }}
                    >
                      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-line bg-panel-elevated">
                        <img src="/qq2007/sidebar-avatar.png" alt="" aria-hidden width={28} height={28} decoding="async" loading="lazy" className="size-7 object-cover" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-1">
                          {sessionListTitle(session, sessionPreviews[session.id])}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-text-3">
                          <span className="shrink-0">
                            {formatSessionTime(
                              isArchivedItem
                                ? session.archivedAt || session.updatedAt
                                : session.updatedAt,
                            )}
                          </span>
                          {session.workspacePath ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate font-mono" title={session.workspacePath}>
                                {workspaceBasename(session.workspacePath)}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    {/* 设计决策：<900 与无 hover 设备常显；宽屏精细指针才 hover 显，避免触控找不到操作 */}
                    <div
                      className={`session-row-actions mt-1 flex gap-1 ${
                        selected
                          ? ""
                          : "min-[900px]:hidden min-[900px]:group-hover:flex min-[900px]:group-focus-within:flex"
                      }`}
                    >
                      {isArchivedItem ? (
                        <>
                          <button
                            className="qq-button h-10 flex-1 text-xs text-text-2 min-[900px]:h-7"
                            disabled={isSessionSwitching || isSelectingWorkspace}
                            type="button"
                            onClick={() => void unarchiveSession(session)}
                          >
                            取消归档
                          </button>
                          <button
                            className="qq-button inline-flex h-10 flex-1 items-center justify-center gap-1 text-xs text-danger min-[900px]:h-7"
                            disabled={isSessionSwitching || isSelectingWorkspace}
                            type="button"
                            onClick={() => void deleteSession(session)}
                          >
                            <Trash2 className="size-3.5 min-[900px]:size-3" aria-hidden />
                            删除
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="qq-button h-10 flex-1 text-xs text-text-2 min-[900px]:h-7"
                            disabled={isSessionSwitching || isSelectingWorkspace}
                            type="button"
                            onClick={() => beginRenameSession(session)}
                          >
                            重命名
                          </button>
                          <button
                            className="qq-button inline-flex h-10 flex-1 items-center justify-center gap-1 text-xs text-text-2 min-[900px]:h-7"
                            disabled={isSessionSwitching || isSelectingWorkspace || (selected && isRunning)}
                            type="button"
                            onClick={() => void archiveSession(session)}
                          >
                            <Archive className="size-3.5 min-[900px]:size-3" aria-hidden />
                            归档
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );

  const desktopSidebarVisible = !isSidebarCollapsed;

  return (
    <main className="relative h-dvh overflow-hidden bg-canvas p-0 text-text-1 min-[720px]:p-1 min-[900px]:p-2">
      <div className="qq-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[4px]">
        {/* QQ 标题栏：窗口控件映射真实网页动作 */}
        <header className="qq-titlebar flex shrink-0 items-center gap-2 px-2">
          <img
            src="/qq2007/sidebar-avatar.png"
            alt=""
            aria-hidden
            width={28}
            height={28}
            decoding="async"
            className="hidden size-7 rounded-[3px] border border-white/30 bg-white/10 object-cover min-[380px]:block"
          />
          <div className="min-w-0">
            <p className="qq-titlebar-title truncate">Mboo Code 2007</p>
          </div>
          <div className="ml-1 hidden items-center gap-0.5 md:flex" aria-hidden="true">
            <span className="qq-chrome-deco inline-flex size-7 items-center justify-center text-xs">←</span>
            <span className="qq-chrome-deco inline-flex size-7 items-center justify-center text-xs">→</span>
            <span className="qq-chrome-deco qq-chrome-deco-label hidden px-2 py-1 text-xs lg:inline">文件</span>
            <span className="qq-chrome-deco qq-chrome-deco-label hidden px-2 py-1 text-xs lg:inline">编辑</span>
            <span className="qq-chrome-deco qq-chrome-deco-label hidden px-2 py-1 text-xs lg:inline">视图</span>
            <span className="qq-chrome-deco qq-chrome-deco-label hidden px-2 py-1 text-xs lg:inline">帮助</span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-1.5">
            <StatusPill status={status} compact />
            {/* 设计决策：手机只有会话抽屉，收栏无桌面侧栏可折叠；重置属低频桌面动作 */}
            <button
              className="qq-window-action hidden items-center justify-center min-[900px]:inline-flex"
              type="button"
              aria-label={isSidebarCollapsed ? "展开左侧会话栏" : "折叠左侧会话栏"}
              title={isSidebarCollapsed ? "展开会话栏" : "折叠会话栏"}
              onClick={() => setIsSidebarCollapsed((current) => !current)}
            >
              {isSidebarCollapsed ? "侧栏" : "收栏"}
            </button>
            <button
              className="qq-window-action inline-flex items-center justify-center"
              type="button"
              aria-label={isFullscreen ? "退出浏览器全屏" : "浏览器全屏"}
              title={isFullscreen ? "退出全屏" : "浏览器全屏"}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? "还原" : "全屏"}
            </button>
            <button
              className="qq-window-action qq-window-action-danger hidden items-center justify-center sm:inline-flex"
              type="button"
              aria-label="重置布局：展开侧栏并退出全屏"
              title="重置布局（不会关闭标签页）"
              onClick={() => void resetWindowLayout()}
            >
              重置
            </button>
          </div>
        </header>

        <div
          className={`grid min-h-0 flex-1 ${
            desktopSidebarVisible
              ? "min-[900px]:max-[1179px]:grid-cols-[minmax(240px,292px)_minmax(0,1fr)] min-[1180px]:grid-cols-[292px_minmax(0,1fr)_210px]"
              : "min-[900px]:max-[1179px]:grid-cols-[minmax(0,1fr)] min-[1180px]:grid-cols-[minmax(0,1fr)_210px]"
          }`}
        >
          {/* 桌面侧栏：联系人式会话索引 */}
          {desktopSidebarVisible ? (
            <aside className="qq-sidebar hidden min-h-0 min-[900px]:flex min-[900px]:flex-col">
              <div className="qq-profile">
                <img src="/qq2007/sidebar-avatar.png" alt="" aria-hidden width={44} height={44} decoding="async" className="qq-profile-avatar" />
                <div className="min-w-0">
                  <p className="qq-profile-name truncate">Mboo Code</p>
                  <p className="qq-profile-status">
                    <span className="qq-status-dot-online" aria-hidden />
                    我在线上
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
                className="qq-sidebar absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] max-w-[100vw] flex-col pt-[env(safe-area-inset-top)] shadow-dock"
              >
                <div className="qq-profile justify-between gap-2 pr-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <img src="/qq2007/sidebar-avatar.png" alt="" aria-hidden width={44} height={44} decoding="async" className="qq-profile-avatar" />
                    <div className="min-w-0">
                      <p className="qq-profile-name truncate">会话</p>
                      <p className="qq-profile-status">
                        <span className="qq-status-dot-online" aria-hidden />
                        选择或管理任务
                      </p>
                    </div>
                  </div>
                  <button
                    aria-label="关闭会话列表"
                    className="qq-button inline-flex size-11 shrink-0 items-center justify-center text-text-2"
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

          <section className="qq-main-surface flex min-h-0 min-w-0 flex-col">
            <div className="shrink-0 border-b border-line bg-panel">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
                <button
                  ref={sessionMenuButtonRef}
                  aria-label="打开会话列表"
                  aria-expanded={isSessionDrawerOpen}
                  aria-haspopup="dialog"
                  className="qq-button inline-flex size-11 items-center justify-center text-text-2 min-[900px]:hidden"
                  type="button"
                  onClick={() => setIsSessionDrawerOpen(true)}
                >
                  <Menu className="size-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h1 className="truncate text-sm font-semibold text-text-1">
                      {currentSession?.title || (sessionId ? "当前会话" : "新任务")}
                    </h1>
                    {isArchivedView ? (
                      <span className="rounded-[2px] border border-running/30 bg-running-soft px-1.5 py-0.5 text-[11px] text-running">
                        归档只读
                      </span>
                    ) : null}
                    {/* 设计决策：空闲态标题栏已有状态；中栏只在异常/连接中补第二枚，避免三处“空闲” */}
                    {status.running || status.label === "异常" || status.label === "连接中" ? (
                      <StatusPill status={status} />
                    ) : null}
                  </div>
                </div>
              </div>

              {isRunning ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-running/25 bg-running-soft px-3 py-2 text-sm text-running sm:px-4"
                  aria-live="polite"
                >
                  <div className="min-w-0">
                    <span className="font-medium">运行中</span>
                    <span className="mx-2 text-running/50">·</span>
                    <span className="truncate">
                      {activeTool
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
                          ? "正在生成回复"
                          : "正在连接"}
                    </span>
                  </div>
                  <button
                    className="qq-button inline-flex h-10 items-center gap-1.5 px-3 text-xs font-medium text-running min-[900px]:h-8"
                    type="button"
                    onClick={stopCurrentRun}
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                    停止
                  </button>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="border-t border-danger/20 bg-danger-soft px-3 py-2 sm:px-4" role="alert">
                  <p className="text-sm text-danger">{errorMessage}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="qq-button inline-flex h-8 items-center gap-1.5 px-2.5 text-xs text-danger"
                      type="button"
                      onClick={() => void copyError()}
                    >
                      <Copy className="size-3.5" aria-hidden />
                      复制错误
                    </button>
                    {lastFailedInput ? (
                      <button
                        className="qq-button inline-flex h-8 items-center gap-1.5 px-2.5 text-xs text-danger"
                        type="button"
                        onClick={retryLastInput}
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        回填上次输入
                      </button>
                    ) : null}
                    <button
                      className="qq-button inline-flex h-8 items-center gap-1.5 px-2.5 text-xs text-text-2"
                      type="button"
                      onClick={() => {
                        setErrorMessage("");
                        setConnectionState("idle");
                      }}
                    >
                      清除
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative min-h-0 flex-1 qq-thread-host">
              {/* 外层 scroller 结构保持稳定：加载中不切换到另一套 qq-thread 壳，避免闪烁 */}
              {messages.length === 0 ? (
                <div className="qq-scrollbar console-scroll qq-thread qq-thread-scroller h-full overflow-y-auto px-3 py-4 sm:px-6">
                  {isSessionSwitching ? (
                    <div className="mx-auto flex max-w-[46rem] flex-col items-center gap-2 py-16 text-text-3">
                      <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden />
                      <p className="text-sm">读取会话事件</p>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-[46rem] rounded-[var(--radius-md)] border border-line bg-panel px-4 py-5 shadow-panel sm:px-5 sm:py-6">
                      {/* 设计决策：缺模型只在输入器保留一个主阻断；空态只给下一步与示例 */}
                      <div className="flex items-center gap-3">
                        <img src="/qq2007/sidebar-avatar.png" alt="" aria-hidden width={48} height={48} decoding="async" className="size-12 rounded-[4px] border border-line object-cover" />
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
                <SessionMessageList
                  sessionId={sessionId || PENDING_SESSION_KEY}
                  messages={messages}
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

            <div className="shrink-0 border-t border-line bg-panel px-3 py-2 sm:px-4">
              {isArchivedView ? (
                <div className="mx-auto max-w-[46rem] rounded-[var(--radius-sm)] border border-running/30 bg-running-soft px-4 py-3 text-sm text-running">
                  当前为归档会话，仅支持回看。可在会话列表中取消归档后继续对话。
                </div>
              ) : (
                <>
                  {pendingApprovalTools.length > 0 ? (
                    <div className="mx-auto mb-2 w-full max-w-[46rem] space-y-2">
                      {pendingApprovalTools.map((toolCall) => (
                        <ToolApprovalCard
                          key={toolCall.approvalId || toolCall.id}
                          toolCall={toolCall}
                          toolLabel={getToolLabel(toolCall.toolName)}
                          onResolveApproval={resolveToolApproval}
                        />
                      ))}
                    </div>
                  ) : null}
                <form className="qq-composer mx-auto w-full max-w-[46rem]" onSubmit={sendMessage}>
                  {!modelName.trim() ? (
                    <div className="flex items-center justify-between gap-2 border-b border-running/30 bg-running-soft px-2.5 py-1.5 text-[11px] text-running">
                      <span>请先填写模型名称后再发送</span>
                      <button
                        className="rounded-[2px] font-medium underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
                        type="button"
                        onClick={focusModelInput}
                      >
                        去填写
                      </button>
                    </div>
                  ) : null}
                  {!isRunning ? (
                    <div className="border-b border-line bg-panel">
                      <button
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs text-text-2 sm:hidden"
                        type="button"
                        aria-expanded={isComposerSettingsOpen || !modelName.trim()}
                        onClick={() => setIsComposerSettingsOpen((current) => !current)}
                      >
                        <span className="min-w-0 truncate">
                          任务设置 · {modelName.trim() || "未填模型"} ·{" "}
                          {workspaceBasename(displayedWorkspacePath) || workspaceStatusText}
                        </span>
                        <ChevronDown
                          className={`size-3.5 shrink-0 transition-transform ${
                            isComposerSettingsOpen || !modelName.trim() ? "" : "-rotate-90"
                          }`}
                          aria-hidden
                        />
                      </button>
                      <div
                        className={`grid gap-2 px-2.5 py-2 sm:grid-cols-[minmax(0,11rem)_7rem_minmax(0,1fr)] ${
                          isComposerSettingsOpen || !modelName.trim() ? "grid" : "hidden"
                        } sm:grid`}
                      >
                        <label className="block min-w-0 text-[11px] font-medium text-text-3">
                          模型
                          <input
                            id="model-input"
                            className="qq-input mt-1 h-8 w-full px-2 text-xs text-text-1 outline-none"
                            placeholder="例如 gpt-4.1"
                            value={modelName}
                            onChange={(event) => setModelName(event.target.value)}
                          />
                        </label>
                        <label className="block min-w-0 text-[11px] font-medium text-text-3">
                          推理
                          <select
                            className="qq-input mt-1 h-8 w-full px-2 text-xs text-text-1 outline-none"
                            value={reasoningEffort}
                            onChange={(event) => setReasoningEffort(event.target.value)}
                          >
                            {REASONING_OPTIONS.map((option) => (
                              <option key={option.value || "default"} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="min-w-0">
                          <WorkspaceBar
                            compact
                            displayedPath={displayedWorkspacePath}
                            statusText={workspaceStatusText}
                            canSelect={!sessionId && !isSessionSwitching && !isArchivedView}
                            isSelecting={isSelectingWorkspace}
                            errorMessage={workspaceMessage}
                            onSelect={() => void selectWorkspace()}
                            onClear={clearPendingWorkspace}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="qq-composer-toolbar">
                    <div className="qq-composer-toolbar-actions">
                      <button
                        className="qq-button inline-flex h-8 items-center gap-1 px-2.5 text-xs text-text-2 sm:h-6 sm:px-2 sm:text-[11px]"
                        type="button"
                        disabled={!input.trim() || isRunning}
                        onClick={() => setInput("")}
                        title="清空输入"
                        aria-label="清空输入"
                      >
                        清空
                      </button>
                      <span className="max-w-[12rem] truncate text-[11px] text-text-3">
                        {isRunning ? (
                          <span className="sm:hidden">生成中，可点停止</span>
                        ) : (
                          <span className="sm:hidden">填好后点发送</span>
                        )}
                        <span className="hidden sm:inline">
                          {isRunning ? "生成中，Esc 可停止" : "⌘/Ctrl + Enter 发送"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <label className="sr-only" htmlFor="task-input">
                    任务输入
                  </label>
                  <div className="qq-composer-editor">
                    <textarea
                      id="task-input"
                      disabled={isRunning || isSessionSwitching || isSelectingWorkspace}
                      placeholder="写下任务目标，或继续追问…"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                    />
                  </div>
                  <div className="qq-composer-statusbar">
                    <p className="min-w-0 truncate text-[11px] text-text-3">
                      {workspaceBasename(displayedWorkspacePath) || workspaceStatusText}
                      {modelName.trim() ? ` · ${modelName.trim()}` : ""}
                    </p>
                    <div className="flex shrink-0 gap-1.5">
                      {isRunning ? (
                        <button
                          className="qq-button inline-flex h-10 items-center gap-1 px-3 text-xs font-medium text-running sm:h-[30px]"
                          type="button"
                          onClick={stopCurrentRun}
                        >
                          <Square className="size-3 fill-current" aria-hidden />
                          停止
                        </button>
                      ) : (
                        <button
                          className={`qq-button-primary inline-flex h-10 min-w-[72px] items-center justify-center px-4 text-xs sm:h-[30px] sm:min-w-[64px] ${
                            !input.trim() || !modelName.trim() || isSessionSwitching || isSelectingWorkspace
                              ? "qq-button-locked"
                              : ""
                          }`}
                          disabled={isRunning || isSessionSwitching || isSelectingWorkspace || !input.trim() || !modelName.trim()}
                          type="submit"
                          title={
                            !modelName.trim()
                              ? "请先填写模型名称"
                              : !input.trim()
                                ? "请先输入任务"
                                : "发送"
                          }
                        >
                          发送
                        </button>
                      )}
                    </div>
                  </div>
                </form>
                </>
              )}
            </div>
          </section>

          <AgentInfoRail
            status={status}
            modelName={modelName}
            workspacePath={displayedWorkspacePath}
            workspaceStatusText={workspaceStatusText}
            recentSessions={recentSessions}
            sessionPreviews={sessionPreviews}
            sessionId={highlightedSessionId}
            pendingApprovalCount={pendingApprovalCount}
            errorMessage={errorMessage}
            isRunning={isRunning}
            onNewSession={startNewSession}
            onRefresh={() => void refreshSessions()}
            onOpenArchived={() => {
              setSessionListTab("archived");
              setIsSidebarCollapsed(false);
            }}
            onOpenSession={(id) => void openSession(id, "active")}
          />
        </div>
      </div>
    </main>
  );
}

const WorkspaceBar = memo(function WorkspaceBar({
  displayedPath,
  statusText,
  canSelect = false,
  isSelecting = false,
  errorMessage = "",
  compact = false,
  onSelect,
  onClear,
}: {
  displayedPath: string;
  statusText: string;
  canSelect?: boolean;
  isSelecting?: boolean;
  errorMessage?: string;
  compact?: boolean;
  onSelect?: () => void;
  onClear?: () => void;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-2 ${
        compact ? "sm:items-center" : ""
      }`}
    >
      <div className="min-w-0">
        <p className={`${compact ? "text-[11px]" : "text-xs"} font-medium text-text-3`}>工作区</p>
        <p
          className={`mt-0.5 truncate font-mono ${compact ? "text-[11px]" : "text-xs"} text-text-2`}
          title={displayedPath || statusText}
        >
          {statusText}
        </p>
        {errorMessage ? <p className="mt-1 text-xs text-danger">{errorMessage}</p> : null}
      </div>
      <div className="flex shrink-0 gap-1">
        {canSelect ? (
          <button
            className={`qq-button inline-flex items-center gap-1.5 px-2.5 font-medium text-text-2 ${
              compact ? "h-7 text-[11px]" : "h-8 text-xs"
            }`}
            disabled={isSelecting}
            type="button"
            onClick={onSelect}
          >
            {isSelecting ? (
              <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
            ) : (
              <FolderOpen className="size-3.5" aria-hidden />
            )}
            选择目录
          </button>
        ) : null}
        {canSelect && displayedPath ? (
          <button
            className={`qq-button inline-flex items-center gap-1.5 px-2.5 text-text-2 ${
              compact ? "h-7 text-[11px]" : "h-8 text-xs"
            }`}
            type="button"
            onClick={onClear}
          >
            <X className="size-3.5" aria-hidden />
            清除
          </button>
        ) : null}
      </div>
    </div>
  );
});

// 普通滚动列表：动态 Markdown 高度下比虚拟列表更稳，避免滚动时整列量高纠偏闪烁
type SessionMessageListProps = {
  sessionId: string;
  messages: ChatMessage[];
};

const SessionMessageList = memo(function SessionMessageList({
  sessionId,
  messages,
}: SessionMessageListProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const syncStickState = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const atBottom = distance <= NEAR_BOTTOM_PX;
    stickToBottomRef.current = atBottom;
    setShowJumpToBottom((prev) => {
      const next = !atBottom;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    scroller.scrollTo({ top: scroller.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    // 切会话后落到末尾；等一帧让消息完成布局
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    const frame = window.requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) {
        return;
      }
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sessionId]);

  useEffect(() => {
    // 仅在用户贴底时跟随内容增长（流式 delta / 历史一次提交）
    if (!stickToBottomRef.current) {
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  return (
    <>
      <div
        ref={scrollerRef}
        className="qq-scrollbar console-scroll qq-thread qq-thread-scroller h-full overflow-y-auto px-3 py-4 sm:px-6"
        onScroll={syncStickState}
      >
        <div className="mx-auto flex min-h-full max-w-[46rem] flex-col">
          {messages.map((message) => (
            <div key={message.id} className="message-item pb-4">
              <MessageBubble message={message} />
            </div>
          ))}
          <div className="h-2 shrink-0" aria-hidden />
        </div>
      </div>
      {showJumpToBottom ? (
        <button
          className="qq-button absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-10 min-h-10 -translate-x-1/2 px-4 py-2 text-xs font-medium text-text-2 shadow-panel min-[900px]:min-h-0 min-[900px]:px-3 min-[900px]:py-1.5"
          type="button"
          aria-label="回到消息列表底部"
          onClick={() => scrollToBottom("smooth")}
        >
          回到底部
        </button>
      ) : null}
    </>
  );
});

const MessageBubble = memo(function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  if (message.role === "assistant") {
    // 设计决策：助手像 QQ 聊天记录里的文档流，少卡片阴影，长回复优先
    const stateText = message.state ? stateLabel(message.state) : "";
    return (
      <article
        className="flex gap-2.5"
        aria-label={stateText ? `Mboo Bot，${stateText}` : "Mboo Bot"}
      >
        <img
          src="/qq2007/sidebar-avatar.png"
          alt=""
          aria-hidden
          width={32}
          height={32}
          decoding="async"
          loading="lazy"
          className="mt-0.5 size-8 shrink-0 rounded-[3px] border border-line object-cover"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-accent" id={`assistant-label-${message.id}`}>
              Mboo Bot
            </span>
            {message.state ? (
              <span className="text-[11px] text-text-3" role="status">
                {stateLabel(message.state)}
              </span>
            ) : null}
            {message.createdAt ? (
              <span className="text-[11px] text-text-3">{formatSessionTime(message.createdAt)}</span>
            ) : null}
          </div>
          <div className="min-w-0 space-y-3 text-text-1">
            {message.parts && message.parts.length > 0 ? (
              message.parts.map((part, partIndex) => {
                if (part.type === "text") {
                  if (!part.text && message.state !== "streaming") {
                    return null;
                  }
                  const isLastPart = partIndex === message.parts!.length - 1;
                  return (
                    <AssistantMarkdown
                      key={part.id}
                      content={part.text}
                      messageId={`${message.id}:${part.id}`}
                      isStreaming={message.state === "streaming" && isLastPart}
                    />
                  );
                }
                return (
                  <ToolTrace
                    key={part.id}
                    toolCalls={[part.toolCall]}
                    isRunning={
                      message.state === "streaming" &&
                      (part.toolCall.status === "started" ||
                        part.toolCall.status === "waiting_approval" ||
                        part.toolCall.status === "submitting")
                    }
                  />
                );
              })
            ) : (
              <>
                {message.text || message.state === "streaming" ? (
                  <AssistantMarkdown
                    content={message.text}
                    messageId={message.id}
                    isStreaming={message.state === "streaming"}
                  />
                ) : null}
                {message.toolCalls && message.toolCalls.length > 0 ? (
                  <ToolTrace
                    toolCalls={message.toolCalls}
                    isRunning={message.state === "streaming"}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </article>
    );
  }

  if (message.role === "user") {
    return (
      <article className="rounded-[var(--radius-sm)] border border-line bg-panel-muted/70 px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold text-text-2">我</span>
          {message.createdAt ? (
            <span className="text-[11px] text-text-3">{formatSessionTime(message.createdAt)}</span>
          ) : null}
        </div>
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-text-1">
          {message.text || " "}
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-[var(--radius-sm)] border border-running/30 bg-running-soft px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-running">系统</span>
        {message.state ? <span className="text-[11px] text-running">{stateLabel(message.state)}</span> : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-1">
        {message.text || " "}
      </p>
    </article>
  );
});

const ToolTrace = memo(function ToolTrace({
  toolCalls,
  isRunning,
}: {
  toolCalls: ToolCallView[];
  isRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasPendingApproval = toolCalls.some(
    (tool) => tool.status === "waiting_approval" || tool.status === "submitting",
  );
  const summaryText = isRunning
    ? "调用工具中"
    : toolCalls.length > 1
      ? "调用了多个工具"
      : "调用了一个工具";

  return (
    <div className="mt-3 overflow-hidden rounded-[var(--radius-sm)] border border-line bg-panel">
      <button
        className="flex w-full min-w-0 cursor-pointer select-none items-center gap-2 bg-panel-muted/60 px-2.5 py-2 text-left text-xs font-medium text-text-2"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-text-3" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-text-3" aria-hidden />
        )}
        {isRunning ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-running" aria-hidden />
        ) : (
          <span className="shrink-0" aria-hidden>🔧</span>
        )}
        <span className="min-w-0 flex-1 truncate text-text-1">{summaryText}</span>
        {hasPendingApproval ? (
          <span className="shrink-0 rounded-[2px] bg-running-soft px-1.5 py-0.5 text-[11px] text-running">
            等待授权
          </span>
        ) : null}
        <span className="shrink-0 font-mono text-[11px] text-text-3">{toolCalls.length}</span>
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-line bg-panel-elevated p-2">
          {toolCalls.map((toolCall) => (
            <ToolTraceItem
              key={toolCall.id}
              toolCall={toolCall}
              toolLabel={getToolLabel(toolCall.toolName)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});

const ToolTraceItem = memo(function ToolTraceItem({
  toolCall,
  toolLabel,
}: {
  toolCall: ToolCallView;
  toolLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-line bg-panel">
      <button
        className="flex w-full min-w-0 cursor-pointer select-none items-center gap-2 bg-panel-muted/60 px-2.5 py-1.5 text-left text-xs font-medium text-text-2"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="shrink-0 text-text-1">🔧 {toolLabel}</span>
        {toolCall.pathText ? (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] font-normal text-text-3"
            title={toolCall.pathText}
          >
            · {toolCall.pathText}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className={`shrink-0 rounded-[2px] px-1.5 py-0.5 text-[11px] ${toolStatusClassName(toolCall.status)}`}>
          {toolStatusLabel(toolCall.status)}
        </span>
        {typeof toolCall.durationMs === "number" ? (
          <span className="shrink-0 font-mono text-[11px] text-text-3">{toolCall.durationMs}ms</span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line bg-panel-elevated px-2.5 py-2.5">
          {toolLabel !== toolCall.toolName ? (
            <p className="font-mono text-[11px] text-text-3">{toolCall.toolName}</p>
          ) : null}
          {toolCall.argumentsText ? (
            <CopyableToolText
              ariaLabel="复制工具参数"
              text={toolCall.argumentsText}
              className="max-h-32"
            />
          ) : null}
          {toolCall.resultPreview ? (
            <ToolResultPreview toolName={toolCall.toolName} text={toolCall.resultPreview} />
          ) : null}
          {toolCall.errorMessage || toolCall.errorCode ? (
            <div className="space-y-1">
              {toolCall.errorMessage ? (
                <p className="break-words text-xs text-danger">{toolCall.errorMessage}</p>
              ) : null}
              {toolCall.errorCode ? (
                <p className="font-mono text-[11px] text-text-3">{toolCall.errorCode}</p>
              ) : null}
            </div>
          ) : null}
          {toolCall.status === "waiting_approval" || toolCall.status === "submitting" ? (
            <p className="text-[11px] leading-5 text-running">
              授权操作在输入框上方，请在底部完成允许或拒绝。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/** 输入框上方授权区：与消息流中的工具轨迹解耦，避免在折叠工具里找按钮 */
const ToolApprovalCard = memo(function ToolApprovalCard({
  toolCall,
  toolLabel,
  onResolveApproval,
}: {
  toolCall: ToolCallView;
  toolLabel: string;
  onResolveApproval: (toolCall: ToolCallView, decision: ToolApprovalDecision) => Promise<void>;
}) {
  const submitting = toolCall.status === "submitting";

  return (
    <div
      className="rounded-[var(--radius-sm)] border border-running/40 bg-running-soft px-3 py-2.5 shadow-panel"
      role="region"
      aria-label="工具授权请求"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-running">
            {toolCall.approvalTitle || "需要工具授权"}
          </p>
          <p className="mt-0.5 text-[11px] text-text-3">
            🔧 {toolLabel}
            {toolCall.pathText ? (
              <span className="font-mono" title={toolCall.pathText}>
                {" "}
                · {toolCall.pathText}
              </span>
            ) : null}
          </p>
        </div>
        <span className={`shrink-0 rounded-[2px] px-1.5 py-0.5 text-[11px] ${toolStatusClassName(toolCall.status)}`}>
          {toolStatusLabel(toolCall.status)}
        </span>
      </div>
      {toolCall.approvalDescription ? (
        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-text-2">{toolCall.approvalDescription}</p>
      ) : null}
      {typeof toolCall.approvalIndex === "number" && typeof toolCall.approvalCount === "number" ? (
        <p className="mt-1 text-[11px] text-text-3">
          授权阶段 {toolCall.approvalIndex}/{toolCall.approvalCount}
        </p>
      ) : null}
      {toolCall.permissionType === "COMMAND" && typeof toolCall.parsedArguments?.command === "string" ? (
        <div className="mt-2 rounded-[3px] border border-running/20 bg-panel-elevated px-2.5 py-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-1">
            {toolCall.parsedArguments.command}
          </pre>
        </div>
      ) : null}
      {toolCall.grantPath &&
      (toolCall.permissionType === "READ" || toolCall.permissionType === "WRITE") ? (
        <div className="mt-2 rounded-[3px] border border-running/20 bg-panel-elevated px-2.5 py-2">
          <p className="break-all font-mono text-xs leading-5 text-text-1">{toolCall.grantPath}</p>
          <p className="mt-1 text-[11px] text-text-3">包含其子目录</p>
        </div>
      ) : null}
      {toolCall.errorMessage ? (
        <p className="mt-2 break-words text-xs text-danger">{toolCall.errorMessage}</p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <button
          className="qq-button-primary px-3 py-1.5 text-xs disabled:opacity-50"
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "ALLOW_ONCE")}
        >
          仅允许本次
        </button>
        <button
          className="qq-button px-3 py-1.5 text-xs text-ok disabled:opacity-50"
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "ALLOW_SESSION")}
        >
          {sessionAllowLabel(toolCall.permissionType)}
        </button>
        <button
          className="qq-button px-3 py-1.5 text-xs text-danger disabled:opacity-50"
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "DENY")}
        >
          拒绝
        </button>
      </div>
      {toolCall.permissionType === "COMMAND" ? (
        <p className="mt-1.5 text-[11px] text-text-3">
          本会话授权只匹配完全相同的命令、工作目录和 Shell 身份
        </p>
      ) : null}
    </div>
  );
});

const CopyableToolText = memo(function CopyableToolText({
  text,
  ariaLabel,
  className = "max-h-40",
}: {
  text: string;
  ariaLabel: string;
  className?: string;
}) {
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
    <div className="relative overflow-hidden rounded-[3px] border border-line bg-panel-muted">
      <button
        className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-[3px] border border-line bg-panel-elevated px-1.5 py-1 text-[10px] text-text-3 hover:text-text-1"
        type="button"
        aria-label={ariaLabel}
        onClick={() => void copy()}
      >
        <Copy className="size-3" aria-hidden />
        {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
      </button>
      <pre className={`console-scroll overflow-auto p-2 pr-16 font-mono text-[11px] leading-5 text-text-2 ${className}`}>
        {text}
      </pre>
    </div>
  );
});

const ToolResultPreview = memo(function ToolResultPreview({
  toolName,
  text,
}: {
  toolName: string;
  text: string;
}) {
  const showDiff = (toolName === "edit_file" || toolName === "write_file") && hasDiffContent(text);

  if (!showDiff) {
    return <CopyableToolText ariaLabel="复制工具结果" text={text} />;
  }

  return (
    <div className="relative overflow-hidden rounded-[3px] border border-line bg-panel-muted">
      <DiffCopyButton text={text} />
      <div className="console-scroll max-h-56 overflow-auto py-2 pr-16 font-mono text-[11px] leading-5 text-text-2">
        {text.split("\n").map((line, index) => (
          <div key={`${index}_${line.slice(0, 16)}`} className={`min-w-max whitespace-pre px-2 ${diffLineClassName(line)}`}>
            {line || " "}
          </div>
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
    <button
      className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-[3px] border border-line bg-panel-elevated px-1.5 py-1 text-[10px] text-text-3 hover:text-text-1"
      type="button"
      aria-label="复制工具结果"
      onClick={() => void copy()}
    >
      <Copy className="size-3" aria-hidden />
      {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制"}
    </button>
  );
});

const StatusPill = memo(function StatusPill({
  status,
  compact = false,
}: {
  status: { label: string; className: string; running?: boolean };
  /** 标题栏深色底上的紧凑态；中栏浅色面不要套 titlebar 皮肤 */
  compact?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-[3px] border px-2 text-[11px] font-medium ${
        compact ? "qq-titlebar-status min-w-0 shrink" : ""
      } ${status.className}`}
      aria-live="polite"
      title={status.label}
      data-running={status.running ? "true" : undefined}
      data-error={status.label === "异常" ? "true" : undefined}
    >
      <span
        className={`qq-status-dot shrink-0 bg-current ${status.running ? "motion-safe:animate-pulse" : ""}`}
        aria-hidden
      />
      <span className={`min-w-0 truncate ${compact ? "qq-titlebar-status-label" : ""}`}>{status.label}</span>
    </span>
  );
});

// 宽屏右栏：只展示真实 Agent 状态，不造虚假社交数据
const AgentInfoRail = memo(function AgentInfoRail({
  modelName,
  workspacePath,
  workspaceStatusText,
  recentSessions,
  sessionPreviews,
  sessionId,
  pendingApprovalCount,
  errorMessage,
  isRunning,
  onOpenSession,
}: {
  status?: { label: string; className: string; running?: boolean };
  modelName: string;
  workspacePath: string;
  workspaceStatusText: string;
  recentSessions: SessionInfo[];
  sessionPreviews: Record<string, string>;
  sessionId: string;
  pendingApprovalCount: number;
  errorMessage: string;
  isRunning: boolean;
  onNewSession?: () => void;
  onRefresh?: () => void;
  onOpenArchived?: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return (
    <aside className="qq-right-rail qq-right-rail-desktop qq-scrollbar console-scroll hidden min-h-0 flex-col overflow-y-auto min-[1180px]:flex">
      {/* 设计决策：立绘压缩为识别点缀，不再抢资料与通知的扫描空间 */}
      <div className="qq-right-show" aria-hidden="true" />

      <section className="border-b border-line/70">
        <div className="qq-right-label-fallback" data-label="profile">
          当前上下文
        </div>
        <div className="space-y-1 px-2.5 py-2">
          <p className="truncate text-sm font-semibold text-text-1">Mboo Bot</p>
          <p className="truncate text-[11px] text-text-3" title={modelName || "模型在中栏配置"}>
            模型：{modelName.trim() || "未配置"}
          </p>
          <p className="truncate text-[11px] text-text-3" title={workspacePath || workspaceStatusText}>
            工作区：{workspaceBasename(workspacePath) || workspaceStatusText}
          </p>
        </div>
      </section>

      {recentSessions.length > 0 ? (
        <section className="border-b border-line/70">
          <div className="qq-right-label-fallback" data-label="recent">
            最近会话
          </div>
          <div className="space-y-0.5 p-1.5">
            {recentSessions.map((session) => {
              const selected = session.id === sessionId;
              return (
                <button
                  key={session.id}
                  className={`flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1.5 text-left ${
                    selected ? "qq-selected-row" : "qq-session-row"
                  }`}
                  type="button"
                  onClick={() => onOpenSession(session.id)}
                >
                  <img src="/qq2007/sidebar-avatar.png" alt="" aria-hidden width={24} height={24} decoding="async" loading="lazy" className="size-6 rounded-[2px] border border-line object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-1">
                      {sessionListTitle(session, sessionPreviews[session.id])}
                    </span>
                    <span className="block truncate text-[11px] text-text-3">
                      {formatSessionTime(session.updatedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {pendingApprovalCount > 0 || errorMessage || isRunning ? (
        <section>
          <div className="qq-right-label-fallback" data-label="notice">
            通知中心
          </div>
          <div className="space-y-1.5 p-2 text-xs text-text-2">
            {pendingApprovalCount > 0 ? (
              <p className="rounded-[3px] border border-running/30 bg-running-soft px-2 py-1.5 text-running">
                待授权工具：{pendingApprovalCount}
              </p>
            ) : null}
            {errorMessage ? (
              <p className="rounded-[3px] border border-danger/30 bg-danger-soft px-2 py-1.5 text-danger">
                最近错误：{errorMessage}
              </p>
            ) : null}
            {isRunning ? (
              <p className="rounded-[3px] border border-line bg-panel-elevated px-2 py-1.5">
                当前状态：运行中
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
});

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
      resultPreview: "",
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
    resultPreview: started ? "" : payloadDisplayText(event.payload.resultPreview),
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

function formatSessionTime(value?: string | null) {
  if (!value) {
    return "时间未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function roleLabel(role: MessageRole) {
  if (role === "assistant") {
    return "助手";
  }

  if (role === "system") {
    return "系统";
  }

  return "用户";
}

function stateLabel(state: MessageState) {
  if (state === "streaming") {
    return "生成中";
  }

  if (state === "complete") {
    return "完成";
  }

  if (state === "cancel") {
    return "已取消";
  }

  if (state === "error") {
    return "错误";
  }

  return "提示";
}

function toolStatusLabel(status: ToolCallStatus) {
  if (status === "waiting_approval") {
    return "等待授权";
  }

  if (status === "submitting") {
    return "处理中";
  }

  if (status === "started") {
    return "运行中";
  }

  if (status === "completed") {
    return "完成";
  }

  if (status === "failed") {
    return "失败";
  }

  return "运行中";
}

function toolStatusClassName(status: ToolCallStatus) {
  if (status === "waiting_approval" || status === "submitting") {
    return "bg-running-soft text-running";
  }

  if (status === "started") {
    return "bg-running-soft text-running";
  }

  if (status === "completed") {
    return "bg-ok-soft text-ok";
  }

  if (status === "failed") {
    return "bg-danger-soft text-danger";
  }

  return "bg-running-soft text-running";
}
