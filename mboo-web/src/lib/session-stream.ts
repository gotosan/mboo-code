import { createParser } from "eventsource-parser";
import type { SessionEvent } from "@/lib/session-types";

const SESSION_EVENT_NAME = "session";

export type SessionStreamOptions = {
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
  let eventChain = Promise.resolve();
  let parseError: SessionStreamError | null = null;
  const parser = createParser({
    onEvent: (message) => {
      if (message.event !== SESSION_EVENT_NAME || !message.data) return;
      let event: SessionEvent;
      try {
        event = JSON.parse(message.data) as SessionEvent;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        parseError = new SessionStreamError(`无法解析后端会话事件：${detail}`);
        return;
      }
      eventChain = eventChain.then(async () => {
        await onEvent(event);
        if (options.paceWithAnimationFrame) {
          await waitAnimationFrame(options.signal);
        }
      });
    },
    onError: (error) => {
      parseError = new SessionStreamError(`无法解析后端会话事件：${error.message}`);
    },
  });

  try {
    while (true) {
      if (options.signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        parser.feed(decoder.decode());
        parser.reset({ consume: true });
        break;
      }

      parser.feed(decoder.decode(value, { stream: true }));
      if (parseError) throw parseError;
    }

    await eventChain;
    if (parseError) throw parseError;
  } finally {
    reader.releaseLock?.();
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
    if (!signal) return;

    const onAbort = () => {
      cancelAnimationFrame(frame);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
