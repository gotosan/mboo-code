export type SessionEventType =
  | "TURN_STARTED"
  | "TURN_COMPLETED"
  | "TURN_FAILED"
  | "TURN_CANCELLED"
  | "TURN_SUPERSEDED"
  | "USER_MESSAGE"
  | "ASSISTANT_MESSAGE"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  | "TOOL_CALL_FAILED"
  | "TOOL_CALL_UNKNOWN"
  | "ASSISTANT_MESSAGE_DELTA";

export type SessionEventSource = "USER" | "ASSISTANT" | "SYSTEM";

export type AssistantMessageState = "completed" | "interrupted";

export type ToolCallStatus = "started" | "completed" | "failed" | "unknown";

export type ChatReq = {
  modelName: string;
  reasoningEffort: string;
  userMessage: string;
  sessionId: string;
};

export type SessionEventPayload = Record<string, unknown>;

export type SessionEvent = {
  eventId: string;
  sessionId: string;
  turnId: string | null;
  type: SessionEventType;
  source: SessionEventSource;
  createdAt: string;
  payload: SessionEventPayload;
  meta: Record<string, unknown>;
};
