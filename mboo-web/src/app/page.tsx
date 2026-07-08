"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type MessageState = AssistantMessageState | "streaming" | "error" | "info";
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

type ToolCallEvent = Extract<
  SessionEvent,
  {
    type: "TOOL_CALL_STARTED" | "TOOL_CALL_COMPLETED" | "TOOL_CALL_FAILED";
  }
>;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [modelName, setModelName] = useState(DEFAULT_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isRunning = connectionState === "running";

  useEffect(() => {
    setSessionId(localStorage.getItem(STORAGE_KEYS.sessionId) ?? "");
    setModelName(localStorage.getItem(STORAGE_KEYS.modelName) ?? DEFAULT_MODEL);
    setReasoningEffort(
      localStorage.getItem(STORAGE_KEYS.reasoningEffort) ?? "",
    );
  }, []);

  useEffect(() => {
    saveLocalValue(STORAGE_KEYS.sessionId, sessionId);
  }, [sessionId]);

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

  const markStreamingMessagesInterrupted = useCallback(() => {
    setMessages((current) =>
      current.map((message) => {
        if (message.role === "assistant" && message.state === "streaming") {
          return { ...message, state: "interrupted" };
        }
        return message;
      }),
    );
  }, []);

  const handleSessionEvent = useCallback(
    (event: SessionEvent) => {
      if (event.sessionId) {
        setSessionId(event.sessionId);
      }

      if (event.turnId) {
        setActiveTurnId(event.turnId);
      }

      if (event.type !== "TURN_FAILED") {
        setErrorMessage("");
      }

      if (event.type === "TURN_STARTED") {
        setConnectionState("running");
        return;
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
        return;
      }

      if (event.type === "TURN_COMPLETED") {
        setConnectionState("idle");
        setActiveTurnId(null);
        return;
      }

      if (event.type === "TURN_CANCELLED") {
        setConnectionState("idle");
        setActiveTurnId(null);
        markStreamingMessagesInterrupted();
        return;
      }

      if (event.type === "TURN_FAILED") {
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
      markStreamingMessagesInterrupted,
      upsertToolCall,
      upsertMessage,
    ],
  );

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      const userMessage = input.trim();
      const selectedModelName = modelName.trim();

      if (!userMessage || isRunning) {
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

        await readSessionEventStream(response, handleSessionEvent);
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
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }

        setActiveTurnId(null);
        setConnectionState((current) =>
          current === "running" ? "idle" : current,
        );
      }
    },
    [
      addSystemMessage,
      handleSessionEvent,
      input,
      isRunning,
      modelName,
      reasoningEffort,
      sessionId,
    ],
  );

  const stopCurrentRun = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    markStreamingMessagesInterrupted();
    setActiveTurnId(null);
    setConnectionState("idle");
  }, [markStreamingMessagesInterrupted]);

  const startNewSession = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages([]);
    setInput("");
    setSessionId("");
    setErrorMessage("");
    setActiveTurnId(null);
    setConnectionState("idle");
    localStorage.removeItem(STORAGE_KEYS.sessionId);
  }, []);

  const status = useMemo(
    () => getStatusView(connectionState, activeTurnId),
    [activeTurnId, connectionState],
  );

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-5 text-zinc-50 lg:flex">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-300">
              Mboo Code
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              会话工作台
            </h1>
          </div>

          <div className="mt-8 space-y-4">
            <StatusPill status={status} />
            <button
              className="h-10 w-full rounded-md border border-zinc-700 px-3 text-sm font-medium text-zinc-100 transition hover:border-emerald-400 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isRunning}
              type="button"
              onClick={startNewSession}
            >
              新会话
            </button>
          </div>

          <div className="mt-8 min-w-0 border-t border-zinc-800 pt-5">
            <p className="text-xs text-zinc-400">Session ID</p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-200">
              {sessionId || "未创建"}
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-zinc-200 bg-white px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-emerald-700">
                  Mboo Code
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal text-zinc-950">
                  会话工作台
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill status={status} />
                <button
                  className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition hover:border-emerald-500 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 lg:hidden"
                  disabled={isRunning}
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
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {messages.length === 0 ? (
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

          <form
            className="border-t border-zinc-200 bg-white px-4 py-4 sm:px-6"
            onSubmit={sendMessage}
          >
            <div className="mx-auto flex max-w-4xl flex-col gap-3">
              <textarea
                className="min-h-28 resize-none rounded-md border border-zinc-300 bg-white px-3 py-3 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                disabled={isRunning}
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
                    disabled={isRunning || !input.trim()}
                    type="submit"
                  >
                    {isRunning ? "发送中" : "发送"}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
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
  return (
    event.type === "TOOL_CALL_STARTED" ||
    event.type === "TOOL_CALL_COMPLETED" ||
    event.type === "TOOL_CALL_FAILED"
  );
}

function toToolCallView(event: ToolCallEvent): ToolCallView {
  const { payload } = event;
  const toolName = payload.toolName || "unknown_tool";
  return {
    id: payload.toolCallId || event.eventId,
    turnId: event.turnId,
    toolName,
    status: toToolCallStatus(event.type),
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

function toToolCallStatus(type: ToolCallEvent["type"]): ToolCallStatus {
  if (type === "TOOL_CALL_COMPLETED") {
    return "completed";
  }

  if (type === "TOOL_CALL_FAILED") {
    return "failed";
  }

  return "started";
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

  if (state === "completed") {
    return "完成";
  }

  if (state === "interrupted") {
    return "已中断";
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
