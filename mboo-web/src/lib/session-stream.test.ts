import assert from "node:assert/strict";
import test from "node:test";

import { readSessionEventStream, SessionStreamError } from "./session-stream";
import type { SessionEvent } from "./session-types";

test("delivers fragmented SSE events in source order after asynchronous handlers", async () => {
  const events = Array.from({ length: 100 }, (_, index) => createDeltaEvent(index));
  const source = events.map((event) => `event: session\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const chunks = [source.slice(0, 37), source.slice(37, 311), source.slice(311)];
  const delivered: string[] = [];

  await readSessionEventStream(new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  })), async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    delivered.push(readDeltaText(event));
  });

  assert.deepEqual(delivered, events.map((event) => event.payload.text));
});

test("reports malformed JSON from a session event without hiding the stream error", async () => {
  const response = new Response("event: session\ndata: {invalid-json}\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });

  await assert.rejects(
    readSessionEventStream(response, () => undefined),
    (error: unknown) => error instanceof SessionStreamError && error.message.includes("无法解析后端会话事件"),
  );
});

test("continues delivering events when the page becomes hidden before the next animation frame", async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const visibilityTarget = new EventTarget();
  const fakeDocument = Object.assign(visibilityTarget, { visibilityState: "visible" });
  const events = [createDeltaEvent(1), createDeltaEvent(2)];
  const source = events.map((event) => `event: session\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const delivered: string[] = [];

  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });

  try {
    const reading = readSessionEventStream(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      (event) => {
        delivered.push(readDeltaText(event));
      },
      { paceWithAnimationFrame: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeDocument.visibilityState = "hidden";
    fakeDocument.dispatchEvent(new Event("visibilitychange"));

    await Promise.race([
      reading,
      new Promise((_, reject) => setTimeout(() => reject(new Error("隐藏页面的事件链仍在等待动画帧")), 100)),
    ]);
    assert.deepEqual(delivered, events.map((event) => event.payload.text));
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: originalRequestAnimationFrame });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: originalCancelAnimationFrame });
  }
});

function readDeltaText(event: SessionEvent): string {
  if (event.type !== "ASSISTANT_MESSAGE_DELTA") {
    throw new Error(`测试流收到非文本增量事件：${event.type}`);
  }
  return event.payload.text;
}

function createDeltaEvent(index: number): SessionEvent & { payload: { text: string } } {
  return {
    eventId: `event-${index}`,
    sessionId: "session-test",
    turnId: "turn-test",
    type: "ASSISTANT_MESSAGE_DELTA",
    source: "ASSISTANT",
    createdAt: new Date(0).toISOString(),
    payload: { messageId: "message-test", text: `联调长回复-${String(index).padStart(3, "0")}` },
    meta: {},
  };
}
