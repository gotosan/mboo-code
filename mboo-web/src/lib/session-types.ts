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

export type TurnStartedPayload = {
  trigger: string;
  userMessageId: string;
};

export type TurnCompletedPayload = {
  durationMs?: number;
};

export type TurnFailedPayload = {
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type TurnCancelledPayload = {
  reason?: string;
  durationMs?: number;
};

export type TurnSupersededPayload = {
  supersededByTurnId?: string;
  reason?: string;
  hiddenInNormalView?: boolean;
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
  | TurnStartedPayload
  | TurnCompletedPayload
  | TurnFailedPayload
  | TurnCancelledPayload
  | TurnSupersededPayload
  | UserMessagePayload
  | AssistantMessagePayload
  | AssistantMessageDeltaPayload
  | ToolCallStartedPayload
  | ToolCallCompletedPayload
  | ToolCallFailedPayload;

export type SessionEvent =
  | SessionEventBase<"TURN_STARTED", TurnStartedPayload>
  | SessionEventBase<"TURN_COMPLETED", TurnCompletedPayload>
  | SessionEventBase<"TURN_FAILED", TurnFailedPayload>
  | SessionEventBase<"TURN_CANCELLED", TurnCancelledPayload>
  | SessionEventBase<"TURN_SUPERSEDED", TurnSupersededPayload>
  | SessionEventBase<"USER_MESSAGE", UserMessagePayload>
  | SessionEventBase<"ASSISTANT_MESSAGE", AssistantMessagePayload>
  | SessionEventBase<"TOOL_CALL_STARTED", ToolCallStartedPayload>
  | SessionEventBase<"TOOL_CALL_COMPLETED", ToolCallCompletedPayload>
  | SessionEventBase<"TOOL_CALL_FAILED", ToolCallFailedPayload>
  | SessionEventBase<"ASSISTANT_MESSAGE_DELTA", AssistantMessageDeltaPayload>;
