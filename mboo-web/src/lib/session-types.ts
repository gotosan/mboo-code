export type SessionEventType =
  | "USER_MESSAGE"
  | "ASSISTANT_MESSAGE"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  | "TOOL_CALL_FAILED"
  | "ERROR"
  | "CANCELLED"
  | "ASSISTANT_MESSAGE_DELTA";

export type SessionEventSource = "USER" | "ASSISTANT" | "SYSTEM";

export type AssistantMessageState = "completed" | "interrupted";

export type ToolCallStatus = "started" | "completed" | "failed";

export type ChatReq = {
  modelName: string;
  reasoningEffort: string;
  userMessage: string;
  sessionId: string;
};

type SessionEventBase<TType extends SessionEventType, TPayload> = {
  eventId: string;
  sessionId: string;
  turnId: string | null;
  type: TType;
  source: SessionEventSource;
  createdAt: string;
  payload: TPayload;
  meta: Record<string, unknown>;
};

export type ErrorPayload = {
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type CancelledPayload = {
  reason?: string;
  durationMs?: number;
};

export type UserMessagePayload = {
  messageId: string;
  text: string;
};

export type AssistantMessagePayload = {
  messageId: string;
  state: AssistantMessageState;
  text: string;
  finishReason?: string;
  reason?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type AssistantMessageDeltaPayload = {
  messageId: string;
  text: string;
};

export type ToolCallStartedPayload = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
};

export type ToolCallCompletedPayload = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  resultPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type ToolCallFailedPayload = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  resultPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type SessionEventPayload =
  | UserMessagePayload
  | AssistantMessagePayload
  | AssistantMessageDeltaPayload
  | ToolCallStartedPayload
  | ToolCallCompletedPayload
  | ToolCallFailedPayload
  | ErrorPayload
  | CancelledPayload;

export type SessionEvent =
  | SessionEventBase<"USER_MESSAGE", UserMessagePayload>
  | SessionEventBase<"ASSISTANT_MESSAGE", AssistantMessagePayload>
  | SessionEventBase<"TOOL_CALL_STARTED", ToolCallStartedPayload>
  | SessionEventBase<"TOOL_CALL_COMPLETED", ToolCallCompletedPayload>
  | SessionEventBase<"TOOL_CALL_FAILED", ToolCallFailedPayload>
  | SessionEventBase<"ERROR", ErrorPayload>
  | SessionEventBase<"CANCELLED", CancelledPayload>
  | SessionEventBase<"ASSISTANT_MESSAGE_DELTA", AssistantMessageDeltaPayload>;
