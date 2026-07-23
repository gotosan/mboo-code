"use client";

import type { FormEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Copy,
  FolderOpen,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
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
  getWeather: "查询天气",
  demoWriteFile: "演示写入权限",
};

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
  resultPreview: string;
  errorMessage: string;
  durationMs?: number;
  createdAt?: string;
  approvalId?: string;
  approvalTitle?: string;
  approvalDescription?: string;
  permissionType?: ToolPermissionType;
  grantPath?: string;
};

type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  state?: MessageState;
  turnId?: string | null;
  createdAt?: string;
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
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [viewingSessionStatus, setViewingSessionStatus] =
    useState<SessionStatus | null>(null);
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  // 移动端会话抽屉与列表过滤（T1/T6）
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState(false);
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const currentSessionIdRef = useRef("");
  const shouldLoadSessionRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>("idle");
  const workspaceSelectionVersionRef = useRef(0);
  // 按会话缓存消息，避免串会话 / 切换后丢失流式结果
  const messagesBySessionRef = useRef<Record<string, ChatMessage[]>>({});
  // 当前 SSE 归属的会话键（新建时先为 pending）
  const streamSessionKeyRef = useRef<string>(PENDING_SESSION_KEY);
  const pendingLocalUserIdRef = useRef<string | null>(null);
  // 移动抽屉 a11y：焦点陷阱与关闭后归还焦点
  const sessionDrawerPanelRef = useRef<HTMLDivElement | null>(null);
  const sessionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const isRunning = connectionState === "running";

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

  useEffect(() => {
    saveLocalValue(STORAGE_KEYS.modelName, modelName);
  }, [modelName]);

  useEffect(() => {
    saveLocalValue(STORAGE_KEYS.reasoningEffort, reasoningEffort);
  }, [reasoningEffort]);

  // 仅在用户接近底部时跟随流式输出，避免长回复阅读时被强行拽走（optimize）
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  // 流式 delta 按帧合并，降低 setState 频率（optimize）
  const pendingDeltasRef = useRef<
    Map<string, { sessionKey: string; messageId: string; text: string; event: SessionEvent }>
  >(new Map());
  const deltaRafRef = useRef<number | null>(null);

  const updateStickToBottom = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const stick = distance < 96;
    stickToBottomRef.current = stick;
    setShowJumpToBottom((prev) => {
      const next = !stick && viewport.scrollHeight > viewport.clientHeight + 24;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollMessagesToBottom = useCallback(() => {
    const viewport = messagesViewportRef.current;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    if (!viewport) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) {
      return;
    }
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    // 直接写 scrollTop，避免 scrollIntoView 在高频流式下触发布局抖动
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, isRunning]);

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
    const preferred =
      focusables.find((el) => el.getAttribute("aria-label") === "关闭") || focusables[0];
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
          return [
            ...current,
            {
              id: messageId,
              role: "assistant",
              text,
              state: "streaming",
              turnId: event.turnId,
              createdAt: event.createdAt,
            },
          ];
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
        next[index] = {
          ...existing,
          text: `${existing.text}${text}`,
          state: "streaming",
          turnId: event.turnId,
          createdAt: existing.createdAt || event.createdAt,
        };
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
            {
              id: messageId,
              role: "assistant",
              text: "",
              state: "streaming",
              turnId: event.turnId,
              createdAt: event.createdAt,
              toolCalls: [toolCall],
            },
          ];
        }

        const next = [...current];
        const existing = next[index];
        const toolCalls = existing.toolCalls ?? [];
        const toolIndex = toolCalls.findIndex((item) => item.id === toolCall.id);
        const nextToolCalls =
          toolIndex < 0
            ? [...toolCalls, toolCall]
            : toolCalls.map((item, itemIndex) =>
                itemIndex === toolIndex ? { ...item, ...toolCall } : item,
              );

        next[index] = {
          ...existing,
          state: existing.state ?? "streaming",
          turnId: existing.turnId || event.turnId,
          createdAt: existing.createdAt || event.createdAt,
          toolCalls: nextToolCalls,
        };
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
          current.map((message) => ({
            ...message,
            toolCalls: message.toolCalls?.map((item) =>
              item.id === toolCall.id ? { ...item, status, errorMessage } : item,
            ),
          })),
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
        // 完整消息以服务端文本为准，丢弃未刷入的 delta，避免拼接重复
        const messageId = event.payload.messageId || event.eventId;
        dropPendingAssistantDelta(targetKey, messageId);
        flushPendingAssistantDeltas();
        upsertMessage(targetKey, {
          id: messageId,
          role: "assistant",
          text: event.payload.text || "",
          state: event.payload.state,
          turnId: event.turnId,
          createdAt: event.createdAt,
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
    shouldLoadSessionRef.current = false;
    currentSessionIdRef.current = "";
    streamSessionKeyRef.current = PENDING_SESSION_KEY;
    pendingLocalUserIdRef.current = null;
    delete messagesBySessionRef.current[PENDING_SESSION_KEY];
    setMessages([]);
    setInput("");
    setSessionId("");
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
      setSessionMessage(toErrorMessage(error));
    } finally {
      setIsLoadingSessions(false);
    }
  }, [clearCurrentSession]);

  const loadSessionEvents = useCallback(async (nextSessionId: string) => {
    if (!nextSessionId) {
      return;
    }

    setIsLoadingHistory(true);
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

      if (detail) {
        const normalized = normalizeSessionInfo(detail);
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
        setViewingSessionStatus(normalized.status);
      }

      currentSessionIdRef.current = nextSessionId;
      streamSessionKeyRef.current = nextSessionId;
      setSessionId(nextSessionId);
      const historyMessages = reduceSessionEventsToMessages(events ?? []);
      messagesBySessionRef.current[nextSessionId] = historyMessages;
      setMessages(historyMessages);
      const firstUser = historyMessages.find((item) => item.role === "user" && item.text.trim());
      if (firstUser) {
        rememberSessionPreview(nextSessionId, firstUser.text);
      }
      setInput("");
      setErrorMessage("");
      setSessionMessage("");
      setEditingSessionId(null);
      setConnectionState((current) => (current === "running" ? current : "idle"));
      if (connectionStateRef.current !== "running") {
        setActiveTurnId(null);
      }
    } catch (error) {
      setSessionMessage(toErrorMessage(error));
      messagesBySessionRef.current[nextSessionId] = [];
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
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
        (!status || status === viewingSessionStatus)
      ) {
        return;
      }

      shouldLoadSessionRef.current = false;
      workspaceSelectionVersionRef.current += 1;
      currentSessionIdRef.current = nextSessionId;
      streamSessionKeyRef.current = nextSessionId;
      setSessionId(nextSessionId);
      setPendingWorkspacePath("");
      setWorkspaceMessage("");
      setIsSelectingWorkspace(false);
      if (status) {
        setViewingSessionStatus(status);
      }
      setIsSessionDrawerOpen(false);
      // 先展示本地缓存（含进行中的流式内容），再与服务端历史对齐
      const cached = messagesBySessionRef.current[nextSessionId];
      if (cached) {
        setMessages(cached);
      }
      // 该会话正在流式输出时不要用服务端历史覆盖未落盘的 DELTA
      if (
        connectionStateRef.current === "running" &&
        streamSessionKeyRef.current === nextSessionId
      ) {
        return;
      }
      await loadSessionEvents(nextSessionId);
    },
    [loadSessionEvents, viewingSessionStatus],
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

      if (!userMessage || isRunning || isLoadingHistory || isSelectingWorkspace) {
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
  const workspaceStatusText = displayedWorkspacePath || (sessionId ? (currentSession ? "未设置工作区" : "工作区加载中") : "默认工作区");
  const isArchivedView =
    viewingSessionStatus === "archived" ||
    currentSession?.status === "archived";
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
      const message = messages[index];
      const tools = message.toolCalls;
      if (!tools?.length) continue;
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
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold text-text-2">会话索引</p>
        <button
          aria-label="刷新会话列表"
          className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-text-2 transition hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45"
          disabled={isLoadingSessions}
          type="button"
          onClick={() => void refreshSessions()}
        >
          <RefreshCw className={`size-3.5 ${isLoadingSessions ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>

      <label className="mt-3 flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-canvas px-2.5 text-text-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only">过滤会话</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-text-1 outline-none placeholder:text-text-3"
          placeholder="搜索标题或 ID"
          value={sessionQuery}
          onChange={(event) => setSessionQuery(event.target.value)}
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-line bg-panel-muted/80 p-1" role="tablist" aria-label="会话分类">
        <button
          role="tab"
          aria-selected={sessionListTab === "active"}
          className={`h-8 rounded-[calc(var(--radius-md)-2px)] text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            sessionListTab === "active"
              ? "bg-panel-elevated text-text-1 shadow-sm"
              : "text-text-3 hover:text-text-1"
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
          className={`h-8 rounded-[calc(var(--radius-md)-2px)] text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            sessionListTab === "archived"
              ? "bg-panel-elevated text-text-1 shadow-sm"
              : "text-text-3 hover:text-text-1"
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

      {sessionMessage ? (
        <p className="mt-3 rounded-[var(--radius-md)] border border-danger/25 bg-danger-soft px-3 py-2 text-xs leading-5 text-danger" role="status">
          {sessionMessage}
        </p>
      ) : null}

      <div className="console-scroll mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {isLoadingSessions ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-line px-3 py-8 text-center text-sm text-text-3">
            正在加载会话
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-line px-3 py-10 text-center">
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
            const selected = session.id === sessionId;
            const editing = editingSessionId === session.id;
            const isArchivedItem = sessionListTab === "archived";

            return (
              <div
                key={session.id}
                className={`session-item group rounded-[var(--radius-md)] border p-2 transition ${
                  selected
                    ? "border-accent bg-accent-soft shadow-[inset_2px_0_0_var(--accent)]"
                    : "border-line/80 bg-panel-elevated/70 hover:border-line-strong"
                }`}
              >
                {editing && !isArchivedItem ? (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="sr-only">会话标题</span>
                      <input
                        className="h-9 w-full rounded-lg border border-line bg-canvas px-2.5 text-sm text-text-1 outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
                        maxLength={80}
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                    </label>
                    <div className="flex gap-1.5">
                      <button
                        className="h-8 flex-1 rounded-lg bg-accent text-xs font-semibold text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                        type="button"
                        onClick={() => void submitRenameSession()}
                      >
                        保存
                      </button>
                      <button
                        className="h-8 flex-1 rounded-lg border border-line text-xs text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
                      className="block w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
                      disabled={isLoadingHistory || isSelectingWorkspace}
                      type="button"
                      onClick={() => {
                        void openSession(session.id, isArchivedItem ? "archived" : "active");
                        options?.onAfterSelect?.();
                      }}
                    >
                      <span className="block truncate text-sm font-medium text-text-1">
                        {sessionListTitle(session, sessionPreviews[session.id])}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-3">
                        <span className="shrink-0">
                          {formatSessionTime(
                            isArchivedItem
                              ? session.archivedAt || session.updatedAt
                              : session.updatedAt,
                          )}
                        </span>
                        {session.workspacePath ? (
                          <>
                            <span className="text-line-strong" aria-hidden>
                              ·
                            </span>
                            <span className="truncate font-mono text-xs" title={session.workspacePath}>
                              {workspaceBasename(session.workspacePath)}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </button>
                    {/* 次级操作：悬停/焦点/选中再显，降低扫视噪声 */}
                    <div
                      className={`mt-1.5 gap-1.5 ${
                        selected
                          ? "flex"
                          : "hidden group-hover:flex group-focus-within:flex"
                      }`}
                    >
                      {isArchivedItem ? (
                        <>
                          <button
                            className="h-7 flex-1 rounded-md border border-line text-xs text-text-2 hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            disabled={isLoadingHistory || isSelectingWorkspace}
                            type="button"
                            onClick={() => void unarchiveSession(session)}
                          >
                            取消归档
                          </button>
                          <button
                            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-line text-xs text-text-2 hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            disabled={isLoadingHistory || isSelectingWorkspace}
                            type="button"
                            onClick={() => void deleteSession(session)}
                          >
                            <Trash2 className="size-3" aria-hidden />
                            删除
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="h-7 flex-1 rounded-md border border-line text-xs text-text-2 hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            disabled={isLoadingHistory || isSelectingWorkspace}
                            type="button"
                            onClick={() => beginRenameSession(session)}
                          >
                            重命名
                          </button>
                          <button
                            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-line text-xs text-text-2 hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                            disabled={isLoadingHistory || isSelectingWorkspace || (selected && isRunning)}
                            type="button"
                            onClick={() => void archiveSession(session)}
                          >
                            <Archive className="size-3" aria-hidden />
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

  return (
    <main className="relative h-dvh overflow-hidden bg-canvas text-text-1">
      <div className="flex h-full min-h-0">
        {/* 桌面侧栏：会话索引 */}
        <aside className="hidden w-[18.5rem] shrink-0 border-r border-line bg-panel lg:flex lg:flex-col">
          <div className="border-b border-line px-4 py-4">
            <p className="text-xs font-medium text-text-3">Mboo Code</p>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-text-1">会话工作台</h1>
            <p className="mt-1 text-xs leading-5 text-text-3">本地任务台 · 长回复优先</p>
            <button
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-semibold text-accent-fg transition hover:bg-accent-strong motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={isRunning || isSelectingWorkspace}
              type="button"
              onClick={startNewSession}
            >
              <Plus className="size-4" aria-hidden strokeWidth={2} />
              新会话
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
            {renderSessionList()}
          </div>
        </aside>

        {/* 移动端会话抽屉（T1） */}
        {isSessionDrawerOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
            <button
              aria-label="关闭会话列表"
              className="absolute inset-0 bg-text-1/40"
              type="button"
              onClick={() => setIsSessionDrawerOpen(false)}
            />
            <div
              ref={sessionDrawerPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="会话列表"
              className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col border-r border-line bg-panel shadow-dock"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-text-3">会话</p>
                  <p className="text-sm font-semibold text-text-1">选择或管理任务</p>
                </div>
                <button
                  aria-label="关闭"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  type="button"
                  onClick={() => setIsSessionDrawerOpen(false)}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="border-b border-line px-3 py-3">
                <button
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent text-sm font-semibold text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-45"
                  disabled={isRunning || isSelectingWorkspace}
                  type="button"
                  onClick={startNewSession}
                >
                  <Plus className="size-4" aria-hidden />
                  新会话
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
                {renderSessionList({ onAfterSelect: () => setIsSessionDrawerOpen(false) })}
              </div>
            </div>
          </div>
        ) : null}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-line bg-panel">
            {/* 顶栏压缩：标题/状态一行，任务前置（模型·推理·工作区）一行 */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
              <button
                ref={sessionMenuButtonRef}
                aria-label="打开会话列表"
                aria-expanded={isSessionDrawerOpen}
                aria-haspopup="dialog"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-text-2 transition hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:hidden"
                type="button"
                onClick={() => setIsSessionDrawerOpen(true)}
              >
                <Menu className="size-4" aria-hidden />
              </button>
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-text-1 sm:flex-none sm:max-w-[16rem]">
                {currentSession?.title || (sessionId ? "当前会话" : "未命名任务")}
              </h2>
              <div aria-live="polite">
                <StatusPill status={status} />
              </div>
              {isArchivedView ? (
                <span className="rounded-md border border-running/30 bg-running-soft px-2 py-0.5 text-xs text-running">
                  归档只读
                </span>
              ) : null}
              {sessionId ? (
                <p
                  className="hidden max-w-[10rem] truncate font-mono text-xs text-text-3 sm:block"
                  title={sessionId}
                >
                  {sessionId.slice(0, 8)}…
                </p>
              ) : null}
            </div>

            {!isRunning ? (
              <div className="grid gap-2 border-t border-line/80 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)_minmax(0,1.2fr)] sm:items-end sm:px-6">
                <label className="block min-w-0 text-xs font-medium text-text-3">
                  模型
                  <input
                    id="model-input"
                    className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-line bg-panel-elevated px-2.5 font-mono text-xs text-text-1 outline-none transition placeholder:text-text-3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
                    placeholder="例如 gpt-4.1"
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                  />
                </label>
                <label className="block min-w-0 text-xs font-medium text-text-3">
                  推理
                  <select
                    className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-line bg-panel-elevated px-2 text-xs text-text-1 outline-none transition focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
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
                    displayedPath={displayedWorkspacePath}
                    statusText={workspaceStatusText}
                    canSelect={!sessionId && !isLoadingHistory && !isArchivedView}
                    isSelecting={isSelectingWorkspace}
                    errorMessage={workspaceMessage}
                    onSelect={() => void selectWorkspace()}
                    onClear={clearPendingWorkspace}
                  />
                </div>
              </div>
            ) : null}

            {isRunning ? (
              <div
                className="flex flex-wrap items-center justify-between gap-2 border-t border-running/25 bg-running-soft px-4 py-2 text-sm text-running sm:px-6"
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
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-running/40 bg-panel px-3 text-xs font-medium text-running focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-running/40"
                  type="button"
                  onClick={stopCurrentRun}
                >
                  <Square className="size-3 fill-current" aria-hidden />
                  停止
                </button>
              </div>
            ) : null}

            {errorMessage ? (
              <div className="border-t border-danger/20 bg-danger-soft px-4 py-2 sm:px-6" role="alert">
                <p className="text-sm text-danger">{errorMessage}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/30 bg-panel px-2.5 text-xs text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                    type="button"
                    onClick={() => void copyError()}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    复制错误
                  </button>
                  {lastFailedInput ? (
                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/30 bg-panel px-2.5 text-xs text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                      type="button"
                      onClick={retryLastInput}
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      回填上次输入
                    </button>
                  ) : null}
                  <button
                    className="inline-flex h-8 items-center rounded-lg border border-line bg-panel px-2.5 text-xs text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    type="button"
                    onClick={() => {
                      setErrorMessage("");
                      setConnectionState("idle");
                    }}
                  >
                    清除错误
                  </button>
                </div>
              </div>
            ) : null}
            {sessionMessage ? (
              <p className="border-t border-running/20 bg-running-soft px-4 py-2 text-sm text-running lg:hidden sm:px-6" role="status">
                {sessionMessage}
              </p>
            ) : null}
          </header>

          <div
            ref={messagesViewportRef}
            className="console-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-8 [scrollbar-gutter:stable]"
            onScroll={updateStickToBottom}
          >
            {isLoadingHistory ? (
              <div className="mx-auto flex min-h-[340px] max-w-[46rem] items-center justify-center rounded-[var(--radius-md)] border border-dashed border-line bg-panel/80 text-center">
                <div>
                  <LoaderCircle className="mx-auto size-5 motion-safe:animate-spin text-accent" aria-hidden />
                  <p className="mt-3 text-sm font-medium text-text-1">正在回显历史</p>
                  <p className="mt-1 text-xs text-text-3">读取会话事件</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-[340px] max-w-[46rem] flex-col justify-center rounded-[var(--radius-md)] border border-line bg-panel-elevated px-6 py-10 shadow-panel sm:px-8">
                <p className="text-xs font-medium text-text-3">尚未开始</p>
                <h3 className="mt-2 text-xl font-semibold text-text-1">先确认工作区与模型</h3>
                <p className="mt-2 max-w-md text-sm leading-7 text-text-2">
                  确认前置条件后，在下方写下任务目标。主区域优先展示长回复与工具轨迹。
                </p>
                <ol className="mt-6 space-y-2.5 text-sm text-text-2">
                  <li className="flex gap-2 rounded-[var(--radius-sm)] border border-line bg-canvas/60 px-3 py-2.5">
                    <span className="font-medium text-text-1">1.</span>
                    <span className="min-w-0 flex-1">
                      工作区：
                      <span className={displayedWorkspacePath ? "text-ok" : "text-text-3"}>
                        {displayedWorkspacePath
                          ? displayedWorkspacePath
                          : sessionId
                            ? "当前会话未设置路径"
                            : "未选择（将使用默认工作区）"}
                      </span>
                      {!sessionId && !displayedWorkspacePath ? (
                        <button
                          className="ml-2 text-xs font-medium text-text-1 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          type="button"
                          disabled={isSelectingWorkspace}
                          onClick={() => void selectWorkspace()}
                        >
                          选择目录
                        </button>
                      ) : null}
                    </span>
                  </li>
                  <li className="flex gap-2 rounded-[var(--radius-sm)] border border-line bg-canvas/60 px-3 py-2.5">
                    <span className="font-medium text-text-1">2.</span>
                    <span className="min-w-0 flex-1">
                      模型：
                      <span className={modelName.trim() ? "font-mono text-text-1" : "text-text-3"}>
                        {modelName.trim() || "未填写"}
                      </span>
                      {!modelName.trim() ? (
                        <button
                          className="ml-2 text-xs font-medium text-text-1 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          type="button"
                          onClick={() => document.getElementById("model-input")?.focus()}
                        >
                          去填写
                        </button>
                      ) : null}
                    </span>
                  </li>
                  <li className="flex gap-2 rounded-[var(--radius-sm)] border border-line bg-canvas/60 px-3 py-2.5">
                    <span className="font-medium text-text-1">3.</span>
                    <span>
                      会话：
                      <span className="text-text-1">
                        {sessionId
                          ? currentSession?.title || "当前会话"
                          : "新任务（发送后创建）"}
                      </span>
                    </span>
                  </li>
                </ol>
                <div className="mt-6 border-t border-line pt-4">
                  <p className="text-xs font-medium text-text-3">快速填入示例</p>
                  <ul className="mt-2 space-y-1">
                    {["梳理代码结构", "定位构建失败", "补一版接口说明"].map((hint) => (
                      <li key={hint}>
                        <button
                          className="w-full rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm text-text-2 transition hover:bg-panel-muted hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          type="button"
                          onClick={() => setInput(hint)}
                        >
                          {hint}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-[46rem] flex-col gap-5 pb-4">
                {messages.map((message) => (
                  <div key={message.id} className="message-item">
                    <MessageBubble message={message} onResolveApproval={resolveToolApproval} />
                  </div>
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
            {showJumpToBottom ? (
              <button
                className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-panel-elevated px-3.5 py-1.5 text-xs font-medium text-text-2 shadow-panel transition hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                type="button"
                onClick={scrollMessagesToBottom}
              >
                回到底部
              </button>
            ) : null}
          </div>

          <div className="shrink-0 px-4 pb-4 pt-1 sm:px-8">
            {isArchivedView ? (
              <div className="mx-auto max-w-[46rem] rounded-[var(--radius-lg)] border border-running/25 bg-running-soft px-4 py-3 text-sm text-running shadow-dock">
                当前为归档会话，仅支持回看。可在会话列表中取消归档后继续对话。
              </div>
            ) : (
              <form
                className="mx-auto max-w-[46rem] rounded-[var(--radius-md)] border border-line-strong/50 bg-panel-elevated p-3 shadow-dock"
                onSubmit={sendMessage}
              >
                <label className="sr-only" htmlFor="task-input">
                  任务输入
                </label>
                <textarea
                  id="task-input"
                  className="min-h-[6.5rem] w-full resize-none rounded-[var(--radius-md)] border border-transparent bg-canvas/80 px-3.5 py-3 text-sm leading-7 text-text-1 outline-none transition placeholder:text-text-3 focus:border-accent/50 focus:bg-canvas focus-visible:ring-2 focus-visible:ring-accent/30"
                  disabled={isRunning || isLoadingHistory || isSelectingWorkspace}
                  placeholder="写下任务目标，或继续追问…（⌘/Ctrl + Enter 发送）"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-text-3">
                    {isRunning
                      ? "生成中，可按 Esc 停止"
                      : !modelName.trim()
                        ? "请先填写模型名称"
                        : "发送前请确认工作区与模型"}
                  </p>
                  <div className="flex gap-2">
                    {isRunning ? (
                      <button
                        className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-md)] border border-running/35 bg-running-soft px-4 text-sm font-medium text-running transition motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-running/40"
                        type="button"
                        onClick={stopCurrentRun}
                      >
                        <Square className="size-3.5 fill-current" aria-hidden />
                        停止
                      </button>
                    ) : null}
                    <button
                      className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:bg-accent-strong motion-safe:active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={isRunning || isLoadingHistory || isSelectingWorkspace || !input.trim() || !modelName.trim()}
                      type="submit"
                    >
                      {isRunning ? "发送中" : "发送"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>
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
  onSelect,
  onClear,
}: {
  displayedPath: string;
  statusText: string;
  canSelect?: boolean;
  isSelecting?: boolean;
  errorMessage?: string;
  onSelect?: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-3">工作区</p>
        <p className="mt-0.5 truncate font-mono text-xs text-text-2" title={displayedPath || statusText}>
          {statusText}
        </p>
        {errorMessage ? <p className="mt-1 text-xs text-danger">{errorMessage}</p> : null}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {canSelect ? (
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel-elevated px-2.5 text-xs font-medium text-text-2 transition hover:border-line-strong hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45"
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
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-text-2 transition hover:border-danger hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
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

const MessageBubble = memo(function MessageBubble({
  message,
  onResolveApproval,
}: {
  message: ChatMessage;
  onResolveApproval: (toolCall: ToolCallView, decision: ToolApprovalDecision) => Promise<void>;
}) {
  if (message.role === "assistant") {
    // 设计决策：助手消息接近文档流，少卡片阴影，长回复优先阅读
    return (
      <article className="border-l-2 border-line-strong/70 pl-4 sm:pl-5">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium text-text-3">助手</span>
          {message.state ? (
            <span className="text-xs text-text-3">{stateLabel(message.state)}</span>
          ) : null}
        </div>
        <div className="text-[15px] leading-8 text-text-1">
          <div className="whitespace-pre-wrap break-words">
            {message.text || (message.state === "streaming" ? "生成中…" : " ")}
          </div>
          {message.toolCalls && message.toolCalls.length > 0 ? (
            <ToolTrace toolCalls={message.toolCalls} onResolveApproval={onResolveApproval} />
          ) : null}
        </div>
      </article>
    );
  }

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-[min(34rem,100%)] rounded-[var(--radius-md)] bg-panel-muted px-3.5 py-2.5">
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-text-1">
          {message.text || " "}
        </p>
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-[min(34rem,100%)] rounded-[var(--radius-md)] border border-running/25 bg-running-soft px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-running">系统</span>
        {message.state ? (
          <span className="text-xs text-running">{stateLabel(message.state)}</span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-1">
        {message.text || " "}
      </p>
    </article>
  );
});

const ToolTrace = memo(function ToolTrace({
  toolCalls,
  onResolveApproval,
}: {
  toolCalls: ToolCallView[];
  onResolveApproval: (toolCall: ToolCallView, decision: ToolApprovalDecision) => Promise<void>;
}) {
  // 最近 1–2 条（或运行中/待授权）默认展开，其余折叠（T3）
  const recentIds = new Set(toolCalls.slice(-2).map((tool) => tool.id));
  const hasActive = toolCalls.some(
    (tool) =>
      tool.status === "started" ||
      tool.status === "waiting_approval" ||
      tool.status === "submitting",
  );

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs font-medium text-text-3">工具轨迹 · {toolCalls.length}</p>
      {toolCalls.map((toolCall) => {
        const toolLabel = getToolLabel(toolCall.toolName);
        const needsAttention =
          toolCall.status === "started" ||
          toolCall.status === "waiting_approval" ||
          toolCall.status === "submitting";
        const openByDefault = hasActive
          ? needsAttention || recentIds.has(toolCall.id)
          : recentIds.has(toolCall.id);

        return (
          <ToolTraceItem
            key={toolCall.id}
            toolCall={toolCall}
            toolLabel={toolLabel}
            initiallyOpen={openByDefault}
            onResolveApproval={onResolveApproval}
          />
        );
      })}
    </div>
  );
});

const ToolTraceItem = memo(function ToolTraceItem({
  toolCall,
  toolLabel,
  initiallyOpen,
  onResolveApproval,
}: {
  toolCall: ToolCallView;
  toolLabel: string;
  initiallyOpen: boolean;
  onResolveApproval: (toolCall: ToolCallView, decision: ToolApprovalDecision) => Promise<void>;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const awaitingApproval =
    Boolean(toolCall.approvalId) &&
    (toolCall.status === "waiting_approval" || toolCall.status === "submitting");

  useEffect(() => {
    if (initiallyOpen) {
      setOpen(true);
    }
  }, [initiallyOpen]);

  return (
    <div className="rounded-[var(--radius-md)] border border-line bg-canvas/70">
      <button
        className="flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="text-text-1">{toolLabel}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-xs ${toolStatusClassName(toolCall.status)}`}>
          {toolStatusLabel(toolCall.status)}
        </span>
        {typeof toolCall.durationMs === "number" ? (
          <span className="font-mono text-xs text-text-3">{toolCall.durationMs}ms</span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-3 py-3">
          {toolLabel !== toolCall.toolName ? (
            <p className="font-mono text-xs text-text-3">{toolCall.toolName}</p>
          ) : null}
          {toolCall.argumentsText ? (
            <pre className="console-scroll max-h-32 overflow-auto rounded-lg bg-panel-muted p-2 font-mono text-xs leading-5 text-text-2">
              {toolCall.argumentsText}
            </pre>
          ) : null}
          {toolCall.resultPreview ? (
            <pre className="console-scroll max-h-40 overflow-auto rounded-lg bg-panel-muted p-2 font-mono text-xs leading-5 text-text-2">
              {toolCall.resultPreview}
            </pre>
          ) : null}
          {toolCall.errorMessage ? (
            <p className="break-words text-xs text-danger">{toolCall.errorMessage}</p>
          ) : null}
          {awaitingApproval ? (
            <div className="rounded-[var(--radius-md)] border border-running/30 bg-running-soft p-3">
              <p className="text-sm font-medium text-running">
                {toolCall.approvalTitle || "需要工具授权"}
              </p>
              {toolCall.approvalDescription ? (
                <p className="mt-1 text-xs leading-5 text-text-2">{toolCall.approvalDescription}</p>
              ) : null}
              {toolCall.grantPath &&
              (toolCall.permissionType === "READ" || toolCall.permissionType === "WRITE") ? (
                <div className="mt-2 rounded-lg border border-running/20 bg-panel/70 px-2.5 py-2">
                  <p className="font-mono text-xs leading-5 text-text-1 break-all">{toolCall.grantPath}</p>
                  <p className="mt-1 text-xs text-text-3">包含其子目录</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  disabled={toolCall.status === "submitting"}
                  type="button"
                  onClick={() => void onResolveApproval(toolCall, "ALLOW_ONCE")}
                >
                  仅允许本次
                </button>
                <button
                  className="rounded-lg border border-ok/40 bg-panel px-3 py-2 text-xs font-medium text-ok disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ok/40"
                  disabled={toolCall.status === "submitting"}
                  type="button"
                  onClick={() => void onResolveApproval(toolCall, "ALLOW_SESSION")}
                >
                  {sessionAllowLabel(toolCall.permissionType)}
                </button>
                <button
                  className="rounded-lg border border-danger/40 bg-panel px-3 py-2 text-xs font-medium text-danger disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                  disabled={toolCall.status === "submitting"}
                  type="button"
                  onClick={() => void onResolveApproval(toolCall, "DENY")}
                >
                  拒绝
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const StatusPill = memo(function StatusPill({
  status,
}: {
  status: { label: string; className: string; running?: boolean };
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${status.className}`}
      aria-live="polite"
    >
      <span
        className={`size-1.5 rounded-full bg-current ${status.running ? "motion-safe:animate-pulse" : ""}`}
        aria-hidden
      />
      {status.label}
    </span>
  );
});

function getStatusView(state: ConnectionState, activeTurnId: string | null) {
  if (state === "running") {
    return {
      label: activeTurnId ? "运行中" : "连接中",
      className: "border-running/30 bg-running-soft text-running",
      running: true,
    };
  }
  if (state === "error") {
    return {
      label: "异常",
      className: "border-danger/30 bg-danger-soft text-danger",
      running: false,
    };
  }
  // 空闲用中性色：绿只留给真正成功态，避免「空闲=成功」误读
  return {
    label: "空闲",
    className: "border-line bg-panel-muted text-text-2",
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

  if (event.type === "TOOL_APPROVAL_REQUIRED") {
    return {
      id: payload.toolCallId || event.eventId,
      turnId: event.turnId,
      toolName,
      status: "waiting_approval",
      argumentsText: payloadDisplayText(payload.arguments),
      resultPreview: "",
      errorMessage: "",
      createdAt: event.createdAt,
      approvalId: event.payload.approvalId,
      approvalTitle: event.payload.title,
      approvalDescription: event.payload.description,
      permissionType: event.payload.permissionType || "TOOL",
      grantPath: event.payload.grantPath || undefined,
    };
  }

  const started = event.type === "TOOL_CALL_STARTED";
  return {
    id: payload.toolCallId || event.eventId,
    turnId: event.turnId,
    toolName,
    status: started ? "started" : event.payload.status,
    argumentsText: payloadDisplayText(payload.arguments),
    resultPreview: started ? "" : payloadDisplayText(event.payload.resultPreview),
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

    if (isToolCallEvent(event)) {
      messages = upsertToolCallSnapshot(messages, event);
      continue;
    }

    if (event.type === "ASSISTANT_MESSAGE") {
      messages = upsertMessageSnapshot(messages, {
        id: event.payload.messageId || event.eventId,
        role: "assistant",
        text: event.payload.text,
        state: event.payload.state,
        turnId: event.turnId,
        createdAt: event.createdAt,
      });
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
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) =>
      toolCall.status === "waiting_approval" || toolCall.status === "submitting"
        ? {
            ...toolCall,
            status: "failed" as const,
            errorMessage: toolCall.errorMessage || "授权请求已失效",
            approvalId: undefined,
          }
        : toolCall,
    ),
  }));
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
      {
        id: messageId,
        role: "assistant" as const,
        text: "",
        state: "streaming" as const,
        turnId: event.turnId,
        createdAt: event.createdAt,
        toolCalls: [toolCall],
      },
    ];
  }

  const next = [...messages];
  const existing = next[index];
  const toolCalls = existing.toolCalls ?? [];
  const toolIndex = toolCalls.findIndex((item) => item.id === toolCall.id);
  const nextToolCalls =
    toolIndex < 0
      ? [...toolCalls, toolCall]
      : toolCalls.map((item, itemIndex) =>
          itemIndex === toolIndex ? { ...item, ...toolCall } : item,
        );

  next[index] = {
    ...existing,
    state: existing.state ?? "streaming",
    turnId: existing.turnId || event.turnId,
    createdAt: existing.createdAt || event.createdAt,
    toolCalls: nextToolCalls,
  };
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
