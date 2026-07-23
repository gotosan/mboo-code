import type { SessionEvent } from "@/lib/session-types";

const SESSION_EVENT_NAMES = new Set(["session"]);

type SseBoundary = {
  index: number;
  length: number;
};

export type SessionStreamOptions = {
  /**
   * 同一网络分片内可能含多个 SSE 事件。按动画帧让出主线程，
   * 让 React 有机会中间渲染，形成打字机效果。
   */
  paceWithAnimationFrame?: boolean;
  signal?: AbortSignal;
};

export class SessionStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStreamError";
  }
}

export async function readSessionEventStream(
  response: Response,
  onEvent: (event: SessionEvent) => void | Promise<void>,
  options: SessionStreamOptions = {},
) {
  if (!response.body) {
    throw new SessionStreamError("后端没有返回可读取的会话事件流");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }

      const { done, value } = await reader.read();

      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = await consumeBufferedMessages(buffer, onEvent, options);
    }

    const remaining = buffer.trim();
    if (remaining.length > 0) {
      await handleSseMessage(remaining, onEvent, options);
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function consumeBufferedMessages(
  buffer: string,
  onEvent: (event: SessionEvent) => void | Promise<void>,
  options: SessionStreamOptions,
) {
  let nextBuffer = buffer;
  let boundary = findSseBoundary(nextBuffer);

  while (boundary) {
    if (options.signal?.aborted) {
      return nextBuffer;
    }

    const rawMessage = nextBuffer.slice(0, boundary.index);
    nextBuffer = nextBuffer.slice(boundary.index + boundary.length);
    await handleSseMessage(rawMessage, onEvent, options);
    boundary = findSseBoundary(nextBuffer);
  }

  return nextBuffer;
}

function findSseBoundary(buffer: string): SseBoundary | null {
  const boundaries = ["\r\n\r\n", "\n\n", "\r\r"]
    .map((delimiter) => ({
      index: buffer.indexOf(delimiter),
      length: delimiter.length,
    }))
    .filter((boundary) => boundary.index >= 0)
    .sort((left, right) => left.index - right.index);

  return boundaries[0] ?? null;
}

async function handleSseMessage(
  rawMessage: string,
  onEvent: (event: SessionEvent) => void | Promise<void>,
  options: SessionStreamOptions,
) {
  if (!rawMessage.trim()) {
    return;
  }

  const { eventName, data } = parseSseMessage(rawMessage);
  if (!SESSION_EVENT_NAMES.has(eventName) || data.length === 0) {
    return;
  }

  let event: SessionEvent;
  try {
    event = JSON.parse(data) as SessionEvent;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    throw new SessionStreamError(`无法解析后端会话事件：${detail}`);
  }

  await onEvent(event);

  if (options.paceWithAnimationFrame) {
    await waitAnimationFrame(options.signal);
  }
}

function waitAnimationFrame(signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      setTimeout(resolve, 0);
      return;
    }

    const frame = requestAnimationFrame(() => resolve());
    if (!signal) {
      return;
    }

    const onAbort = () => {
      cancelAnimationFrame(frame);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function parseSseMessage(rawMessage: string) {
  let eventName = "";
  const dataLines: string[] = [];

  for (const line of rawMessage.split(/\r\n|\n|\r/)) {
    if (line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    let value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";

    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      eventName = value;
    }

    if (field === "data") {
      dataLines.push(value);
    }
  }

  return {
    eventName,
    data: dataLines.join("\n"),
  };
}
