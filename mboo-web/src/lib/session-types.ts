export type SessionEventType =
  | "USER_MESSAGE"
  | "ASSISTANT_MESSAGE"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_ENDED"
  | "TOOL_APPROVAL_REQUIRED"
  | "CONTEXT_COMPRESSION"
  | "ERROR"
  | "CANCELLED"
  | "ASSISTANT_MESSAGE_DELTA"
  | "CONTEXT_USAGE_UPDATED";

export type SessionEventSource = "USER" | "ASSISTANT" | "SYSTEM";

export type AssistantMessageState = "streaming" | "complete" | "cancel" | "error";

export type ToolCallStatus = "waiting_approval" | "submitting" | "started" | "completed" | "failed";

export type ToolApprovalDecision = "ALLOW_ONCE" | "ALLOW_SESSION" | "DENY";

export type ToolPermissionType = "NONE" | "TOOL" | "READ" | "WRITE" | "COMMAND" | "NETWORK";

export type PermissionMode = "DEFAULT" | "FULL_ACCESS";

export type ChatReq = {
  modelName: string;
  reasoningEffort: string;
  userMessage: string;
  workspacePath: string;
  permissionMode?: PermissionMode;
  sessionId: string;
};

export type ModelLimit = {
  context: number;
  input?: number | null;
  output: number;
};

export type ModelInfo = {
  modelId: string;
  name: string;
  family?: string | null;
  status?: string | null;
  limit: ModelLimit;
  toolCall: boolean;
  reasoning: boolean;
  reasoningOptions: Record<string, unknown>[];
  attachment: boolean;
  inputModalities: string[];
  outputModalities: string[];
};

export type ModelContextLimit = {
  modelId: string;
  minimumContextLimit: number;
  maximumContextLimit: number;
  configuredContextLimit?: number | null;
  effectiveContextLimit: number;
  adjustable: boolean;
};

export type ContextUsageSnapshot = {
  modelId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens: number;
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
  errorMessage?: string;
  durationMs?: number;
};

export type CancelledPayload = {
  durationMs?: number;
};

export type UserMessagePayload = {
  messageId: string;
  text: string;
  modelName?: string;
};

export type AssistantMessagePayload = {
  messageId: string;
  state: AssistantMessageState;
  text: string;
  errorMessage?: string;
  durationMs?: number;
  contextUsage?: ContextUsageSnapshot | null;
};

export type AssistantMessageDeltaPayload = {
  messageId: string;
  text: string;
};

export type ContextUsageUpdatedPayload = ContextUsageSnapshot & {
  messageId: string;
};

export type ContextCompressionTrigger = "auto" | "manual";
export type ContextCompressionState = "started" | "completed" | "failed" | "skipped";

export type ContextCompressionPayload = {
  compressionId: string;
  trigger: ContextCompressionTrigger;
  state: ContextCompressionState;
  modelId?: string | null;
  previousUsage?: ContextUsageSnapshot | null;
  previousContextLimit?: number | null;
  summarizedTurnCount?: number | null;
  retainedTurnCount?: number | null;
  compactedToolCallCount?: number | null;
  beforeMessageCount?: number | null;
  afterMessageCount?: number | null;
  beforeEstimatedTokens?: number | null;
  afterEstimatedTokens?: number | null;
  durationMs?: number | null;
  skipReason?: string | null;
  errorMessage?: string | null;
};

export type ToolCallStartedPayload = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
};

export type ToolApprovalRequiredPayload = {
  messageId: string;
  approvalId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  title: string;
  description: string;
  permissionType?: ToolPermissionType | null;
  grantPath?: string | null;
  grantOrigin?: string | null;
  approvalIndex?: number;
  approvalCount?: number;
};

export type ToolCallEndedPayload = {
  messageId: string;
  toolCallId: string;
  toolName: string;
  arguments: string;
  status: "completed" | "failed";
  resultId: string;
  resultSizeBytes?: number;
  rawOutputAvailable?: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs?: number;
};

export type ToolResultDetail = {
  resultId: string;
  toolCallId: string;
  toolName: string;
  status: "completed" | "failed";
  contentType: string;
  resultPreview: string;
  resultSizeBytes?: number;
  rawOutputAvailable?: boolean;
  rawOutputComplete?: boolean;
  rawOutputSizeBytes?: number;
  createdAt?: string;
};

export type SessionEventPayload =
  | UserMessagePayload
  | AssistantMessagePayload
  | AssistantMessageDeltaPayload
  | ContextUsageUpdatedPayload
  | ToolCallStartedPayload
  | ToolApprovalRequiredPayload
  | ToolCallEndedPayload
  | ContextCompressionPayload
  | ErrorPayload
  | CancelledPayload;

export type SessionEvent =
  | SessionEventBase<"USER_MESSAGE", UserMessagePayload>
  | SessionEventBase<"ASSISTANT_MESSAGE", AssistantMessagePayload>
  | SessionEventBase<"TOOL_CALL_STARTED", ToolCallStartedPayload>
  | SessionEventBase<"TOOL_APPROVAL_REQUIRED", ToolApprovalRequiredPayload>
  | SessionEventBase<"TOOL_CALL_ENDED", ToolCallEndedPayload>
  | SessionEventBase<"CONTEXT_COMPRESSION", ContextCompressionPayload>
  | SessionEventBase<"ERROR", ErrorPayload>
  | SessionEventBase<"CANCELLED", CancelledPayload>
  | SessionEventBase<"ASSISTANT_MESSAGE_DELTA", AssistantMessageDeltaPayload>
  | SessionEventBase<"CONTEXT_USAGE_UPDATED", ContextUsageUpdatedPayload>;
