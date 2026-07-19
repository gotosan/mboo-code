"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, LoaderCircle, X } from "lucide-react";
import { readSessionEventStream } from "@/lib/session-stream";
import type {
  AssistantMessageState,
  ChatReq,
  SessionEvent,
  ToolCallStatus,
} from "@/lib/session-types";

const STORAGE_KEYS = {
  sessionId: "mboo-web.sessionId",
  modelName: "mboo-web.modelName",
  reasoningEffort: "mboo-web.reasoningEffort",
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
};

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
    type: "TOOL_CALL_STARTED" | "TOOL_CALL_ENDED";
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

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const currentSessionIdRef = useRef("");
  const shouldLoadSessionRef = useRef(false);
  const connectionStateRef = useRef<ConnectionState>("idle");
  const workspaceSelectionVersionRef = useRef(0);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isRunning]);

  const addSystemMessage = useCallback(
    (text: string, state: MessageState = "info") => {
      setMessages((current) => [
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
    [],
  );

  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === message.id);

      if (index < 0) {
        return [...current, message];
      }

      const next = [...current];
      next[index] = { ...next[index], ...message };
      return next;
    });
  }, []);

  const appendAssistantDelta = useCallback(
    (messageId: string, text: string, event: SessionEvent) => {
      setMessages((current) => {
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
        if (existing.state === "complete" || existing.state === "cancel" || existing.state === "error") {
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
    [],
  );

  const upsertToolCall = useCallback((event: ToolCallEvent) => {
    const toolCall = toToolCallView(event);
    const messageId =
      event.payload.messageId ||
      (event.turnId ? `assistant_${event.turnId}` : event.eventId);

    setMessages((current) => {
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
  }, []);

  const markStreamingMessagesCancelled = useCallback((turnId: string | null) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.role === "assistant" && message.state === "streaming" && (!turnId || message.turnId === turnId)) {
          return { ...message, state: "cancel" };
        }
        return message;
      }),
    );
  }, []);

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      const eventSessionId = event.sessionId || "";
      const currentSessionId = currentSessionIdRef.current;

      if (eventSessionId && !currentSessionId) {
        currentSessionIdRef.current = eventSessionId;
        setSessionId(event.sessionId);
      } else if (eventSessionId && eventSessionId !== currentSessionId) {
        return;
      }

      if (event.turnId) {
        setActiveTurnId(event.turnId);
      }

      if (event.type !== "ERROR") {
        setErrorMessage("");
      }

      if (event.type === "USER_MESSAGE") {
        upsertMessage({
          id: event.payload.messageId || event.eventId,
          role: "user",
          text: event.payload.text,
          turnId: event.turnId,
          createdAt: event.createdAt,
        });
        return;
      }

      if (event.type === "ASSISTANT_MESSAGE_DELTA") {
        const messageId = event.payload.messageId || event.eventId;
        appendAssistantDelta(messageId, event.payload.text, event);
        return;
      }

      if (isToolCallEvent(event)) {
        upsertToolCall(event);
        return;
      }

      if (event.type === "ASSISTANT_MESSAGE") {
        upsertMessage({
          id: event.payload.messageId || event.eventId,
          role: "assistant",
          text: event.payload.text,
          state: event.payload.state,
          turnId: event.turnId,
          createdAt: event.createdAt,
        });
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
        setConnectionState("idle");
        setActiveTurnId(null);
        markStreamingMessagesCancelled(event.turnId);
        addSystemMessage("本轮会话已取消", "info");
        return;
      }

      if (event.type === "ERROR") {
        const message = event.payload.errorMessage || "本轮会话执行失败";
        setConnectionState("error");
        setErrorMessage(message);
        setActiveTurnId(null);
        addSystemMessage(message, "error");
      }
    },
    [
      addSystemMessage,
      appendAssistantDelta,
      markStreamingMessagesCancelled,
      upsertToolCall,
      upsertMessage,
    ],
  );

  const clearCurrentSession = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    workspaceSelectionVersionRef.current += 1;
    shouldLoadSessionRef.current = false;
    currentSessionIdRef.current = "";
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

      // 会话已被硬删除或不存在时，切回未选中
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
      const response = await fetch(
        `/api/session/${encodeURIComponent(nextSessionId)}/events`,
        { cache: "no-store" },
      );
      const events = await readApiData<SessionEvent[]>(response);
      currentSessionIdRef.current = nextSessionId;
      setSessionId(nextSessionId);
      setMessages(reduceSessionEventsToMessages(events ?? []));
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
      setMessages([]);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

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
      setSessionId(nextSessionId);
      setPendingWorkspacePath("");
      setWorkspaceMessage("");
      setIsSelectingWorkspace(false);
      if (status) {
        setViewingSessionStatus(status);
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

  const deleteSession = useCallback(
    async (target: SessionInfo) => {
      if (!window.confirm("删除后不可恢复，确认删除该会话？")) {
        return;
      }

      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(target.id)}`,
          { method: "DELETE" },
        );
        await readApiData<void>(response);
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
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      setConnectionState("running");
      setErrorMessage("");
      setInput("");

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

        await readSessionEventStream(response, (sessionEvent) => {
          if (
            abortControllerRef.current !== controller ||
            controller.signal.aborted
          ) {
            return;
          }
          handleSessionEvent(sessionEvent);
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message = toErrorMessage(error);
        setConnectionState("error");
        setErrorMessage(message);
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
      handleSessionEvent,
      input,
      isLoadingHistory,
      isRunning,
      isSelectingWorkspace,
      modelName,
      pendingWorkspacePath,
      reasoningEffort,
      refreshSessions,
      sessionId,
    ],
  );

  const stopCurrentRun = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    handleSessionEvent({
      eventId: createLocalId("cancelled"),
      sessionId: currentSessionIdRef.current,
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
    void refreshSessions();
  }, [clearCurrentSession, refreshSessions]);

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
  const visibleSessions =
    sessionListTab === "active" ? sessions : archivedSessions;

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-5 text-zinc-50 lg:flex">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-300">
              Mboo Code
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              会话工作台
            </h1>
          </div>

          <div className="mt-8 space-y-3">
            <StatusPill status={status} />
            <button
              className="h-10 w-full rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRunning || isSelectingWorkspace}
              type="button"
              onClick={startNewSession}
            >
              新会话
            </button>
          </div>

          <div className="mt-6 min-w-0 border-t border-zinc-800 pt-5">
            <p className="text-xs text-zinc-400">Session ID</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-200">
              {sessionId || "未创建"}
            </p>
          </div>

          <div className="mt-6 flex min-h-0 flex-1 flex-col border-t border-zinc-800 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-100">会话列表</p>
              <button
                className="h-8 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoadingSessions}
                type="button"
                onClick={() => void refreshSessions()}
              >
                刷新
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className={`h-8 rounded-md border px-2 text-xs transition ${
                  sessionListTab === "active"
                    ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
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
                className={`h-8 rounded-md border px-2 text-xs transition ${
                  sessionListTab === "archived"
                    ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                    : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
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
              <p className="mt-3 rounded-md border border-rose-900/70 bg-rose-950/40 px-3 py-2 text-xs leading-5 text-rose-100">
                {sessionMessage}
              </p>
            ) : null}

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {isLoadingSessions ? (
                <p className="rounded-md border border-zinc-800 px-3 py-3 text-sm text-zinc-400">
                  正在加载会话
                </p>
              ) : visibleSessions.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
                  {sessionListTab === "active" ? "暂无活跃会话" : "暂无归档会话"}
                </p>
              ) : (
                <div className="space-y-2">
                  {visibleSessions.map((session) => {
                    const selected = session.id === sessionId;
                    const editing = editingSessionId === session.id;
                    const isArchivedItem = sessionListTab === "archived";

                    return (
                      <div
                        key={session.id}
                        className={`rounded-md border p-2 transition ${
                          selected
                            ? "border-emerald-500 bg-emerald-950/30"
                            : "border-zinc-800 bg-zinc-900/70"
                        }`}
                      >
                        {editing && !isArchivedItem ? (
                          <div className="space-y-2">
                            <input
                              className="h-9 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400"
                              maxLength={80}
                              value={titleDraft}
                              onChange={(event) =>
                                setTitleDraft(event.target.value)
                              }
                            />
                            <div className="flex gap-2">
                              <button
                                className="h-8 flex-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white transition hover:bg-emerald-500"
                                type="button"
                                onClick={() => void submitRenameSession()}
                              >
                                保存
                              </button>
                              <button
                                className="h-8 flex-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-zinc-500"
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
                              className="block w-full min-w-0 text-left"
                              disabled={isLoadingHistory || isSelectingWorkspace}
                              type="button"
                              onClick={() =>
                                void openSession(
                                  session.id,
                                  isArchivedItem ? "archived" : "active",
                                )
                              }
                            >
                              <span className="block truncate text-sm font-medium text-zinc-100">
                                {session.title || "新会话"}
                              </span>
                              <span className="mt-1 block truncate text-xs text-zinc-500">
                                {formatSessionTime(
                                  isArchivedItem
                                    ? session.archivedAt || session.updatedAt
                                    : session.updatedAt,
                                )}
                              </span>
                            </button>
                            <div className="mt-3 flex gap-2">
                              {isArchivedItem ? (
                                <>
                                  <button
                                    className="h-8 flex-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-200"
                                    type="button"
                                    onClick={() => void unarchiveSession(session)}
                                  >
                                    取消归档
                                  </button>
                                  <button
                                    className="h-8 flex-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-rose-400 hover:text-rose-100"
                                    type="button"
                                    onClick={() => void deleteSession(session)}
                                  >
                                    删除
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="h-8 flex-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-200"
                                    type="button"
                                    onClick={() => beginRenameSession(session)}
                                  >
                                    重命名
                                  </button>
                                  <button
                                    className="h-8 flex-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 transition hover:border-amber-400 hover:text-amber-100"
                                    type="button"
                                    onClick={() => void archiveSession(session)}
                                  >
                                    归档
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-emerald-700">
                  Mboo Code
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-normal text-zinc-950">
                    {currentSession?.title || "会话工作台"}
                  </h2>
                  {isArchivedView ? (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                      已归档（只读）
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 break-all text-xs text-zinc-500">
                  {sessionId ? `Session ID：${sessionId}` : "未打开会话"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill status={status} />
                <button
                  className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:border-emerald-500 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
                  disabled={isRunning || isSelectingWorkspace}
                  type="button"
                  onClick={startNewSession}
                >
                  新会话
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
              <label className="min-w-0 text-sm font-medium text-zinc-700">
                模型
                <input
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="例如 gpt-4.1"
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                />
              </label>

              <label className="text-sm font-medium text-zinc-700">
                推理深度
                <select
                  className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
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
            </div>

            {errorMessage ? (
              <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {errorMessage}
              </p>
            ) : null}
            {sessionMessage ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 lg:hidden">
                {sessionMessage}
              </p>
            ) : null}
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {isLoadingHistory ? (
              <div className="mx-auto flex min-h-[360px] max-w-2xl items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white text-center">
                <div className="px-6">
                  <p className="text-lg font-semibold text-zinc-900">
                    正在回显会话
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    正在读取历史事件
                  </p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-[360px] max-w-2xl items-center justify-center rounded-md border border-dashed border-zinc-300 bg-white text-center">
                <div className="px-6">
                  <p className="text-lg font-semibold text-zinc-900">
                    等待新的会话
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    当前没有消息记录
                  </p>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {isArchivedView ? (
            <div className="border-t border-zinc-200 bg-white px-4 py-4 sm:px-6">
              <div className="mx-auto flex max-w-4xl flex-col gap-3">
                <WorkspaceBar
                  displayedPath={displayedWorkspacePath}
                  statusText={workspaceStatusText}
                />
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  当前为归档会话，仅支持回看历史。可在侧栏取消归档后继续对话。
                </div>
              </div>
            </div>
          ) : (
            <form
              className="border-t border-zinc-200 bg-white px-4 py-4 sm:px-6"
              onSubmit={sendMessage}
            >
              <div className="mx-auto flex max-w-4xl flex-col gap-3">
                <WorkspaceBar
                  displayedPath={displayedWorkspacePath}
                  statusText={workspaceStatusText}
                  canSelect={!sessionId && !isRunning && !isLoadingHistory}
                  isSelecting={isSelectingWorkspace}
                  errorMessage={workspaceMessage}
                  onSelect={() => void selectWorkspace()}
                  onClear={clearPendingWorkspace}
                />
                <textarea
                  className="min-h-28 resize-none rounded-md border border-zinc-300 bg-white px-3 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  disabled={isRunning || isLoadingHistory || isSelectingWorkspace}
                  placeholder="输入消息"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-h-5 text-sm text-zinc-500">
                    {sessionId ? `当前会话：${sessionId}` : "当前会话：未创建"}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    {isRunning ? (
                      <button
                        className="h-10 rounded-md border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
                        type="button"
                        onClick={stopCurrentRun}
                      >
                        停止
                      </button>
                    ) : null}
                    <button
                      className="h-10 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
                      disabled={isRunning || isLoadingHistory || isSelectingWorkspace || !input.trim()}
                      type="submit"
                    >
                      {isRunning ? "发送中" : "发送"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function WorkspaceBar({
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
    <div className="min-w-0">
      <div className="flex min-h-12 min-w-0 items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
        <FolderOpen aria-hidden="true" className="size-4 shrink-0 text-emerald-700" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-zinc-500">工作区</p>
          <p className="truncate text-sm text-zinc-800" title={displayedPath || statusText}>
            {statusText}
          </p>
        </div>
        {canSelect ? (
          <div className="flex shrink-0 gap-1">
            <button
              aria-label={displayedPath ? "重新选择工作区" : "选择工作区"}
              className="flex size-9 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition hover:border-emerald-500 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSelecting}
              title={displayedPath ? "重新选择工作区" : "选择工作区"}
              type="button"
              onClick={onSelect}
            >
              {isSelecting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <FolderOpen aria-hidden="true" className="size-4" />}
            </button>
            {displayedPath ? (
              <button
                aria-label="恢复默认工作区"
                className="flex size-9 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 transition hover:border-rose-400 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSelecting}
                title="恢复默认工作区"
                type="button"
                onClick={onClear}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {errorMessage ? <p className="mt-2 text-sm text-rose-700">{errorMessage}</p> : null}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const bubbleClassName =
    message.role === "user"
      ? "ml-auto border-emerald-200 bg-emerald-50"
      : message.role === "assistant"
        ? "mr-auto border-zinc-200 bg-white"
        : "mx-auto border-amber-200 bg-amber-50";

  return (
    <article
      className={`max-w-[min(760px,100%)] rounded-md border px-4 py-3 shadow-sm ${bubbleClassName}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-zinc-500">
          {roleLabel(message.role)}
        </span>
        {message.state ? (
          <span className="shrink-0 rounded-sm bg-zinc-100 px-2 py-1 text-xs text-zinc-600">
            {stateLabel(message.state)}
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-900">
        {message.text || " "}
      </p>
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <ToolTrace toolCalls={message.toolCalls} />
      ) : null}
    </article>
  );
}

function ToolTrace({ toolCalls }: { toolCalls: ToolCallView[] }) {
  return (
    <details className="mt-3 border-t border-zinc-200 pt-3">
      <summary className="cursor-pointer select-none text-xs font-semibold text-zinc-600">
        工具调用 · {toolCalls.length}
      </summary>
      <div className="mt-3 divide-y divide-zinc-100">
        {toolCalls.map((toolCall) => {
          const toolLabel = getToolLabel(toolCall.toolName);

          return (
            <div key={toolCall.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {toolLabel}
                  </p>
                  {toolLabel !== toolCall.toolName ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      {toolCall.toolName}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {typeof toolCall.durationMs === "number" ? (
                    <span className="text-xs text-zinc-500">
                      {toolCall.durationMs}ms
                    </span>
                  ) : null}
                  <span
                    className={`rounded-sm px-2 py-1 text-xs ${toolStatusClassName(
                      toolCall.status,
                    )}`}
                  >
                    {toolStatusLabel(toolCall.status)}
                  </span>
                </div>
              </div>

              {toolCall.argumentsText ? (
                <pre className="mt-2 max-h-36 overflow-auto rounded-sm bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">
                  {toolCall.argumentsText}
                </pre>
              ) : null}

              {toolCall.resultPreview ? (
                <pre className="mt-2 max-h-44 overflow-auto rounded-sm bg-zinc-50 p-2 text-xs leading-5 text-zinc-700">
                  {toolCall.resultPreview}
                </pre>
              ) : null}

              {toolCall.errorMessage ? (
                <p className="mt-2 break-words text-xs leading-5 text-rose-700">
                  {toolCall.errorMessage}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function StatusPill({
  status,
}: {
  status: { label: string; className: string };
}) {
  return (
    <span
      className={`inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium ${status.className}`}
    >
      {status.label}
    </span>
  );
}

function getStatusView(state: ConnectionState, activeTurnId: string | null) {
  if (state === "running") {
    return {
      label: activeTurnId ? "运行中" : "连接中",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (state === "error") {
    return {
      label: "异常",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    };
  }

  return {
    label: "空闲",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
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
  return event.type === "TOOL_CALL_STARTED" || event.type === "TOOL_CALL_ENDED";
}

function toToolCallView(event: ToolCallEvent): ToolCallView {
  const { payload } = event;
  const toolName = payload.toolName || "unknown_tool";
  return {
    id: payload.toolCallId || event.eventId,
    turnId: event.turnId,
    toolName,
    status: event.type === "TOOL_CALL_STARTED" ? "started" : event.payload.status,
    argumentsText: payloadDisplayText(payload.arguments),
    resultPreview:
      event.type === "TOOL_CALL_STARTED"
        ? ""
        : payloadDisplayText(event.payload.resultPreview),
    errorMessage:
      event.type === "TOOL_CALL_STARTED"
        ? ""
        : event.payload.errorMessage || "",
    durationMs:
      event.type === "TOOL_CALL_STARTED" ? undefined : event.payload.durationMs,
    createdAt: event.createdAt,
  };
}

function getToolLabel(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName;
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

  return messages;
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
  if (status === "started") {
    return "bg-amber-50 text-amber-800";
  }

  if (status === "completed") {
    return "bg-emerald-50 text-emerald-800";
  }

  if (status === "failed") {
    return "bg-rose-50 text-rose-800";
  }

  return "bg-amber-50 text-amber-800";
}
