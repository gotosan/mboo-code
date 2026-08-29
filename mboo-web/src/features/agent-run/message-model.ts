import type {
  AssistantMessageState,
  ToolCallStatus,
  ToolPermissionType,
  ToolResultDetail,
  AskQuestion,
} from "@/lib/session-types";

export type MessageRole = "user" | "assistant" | "system";
export type MessageState = AssistantMessageState | "info";

export type ToolCallView = {
  id: string;
  turnId?: string | null;
  toolName: string;
  status: ToolCallStatus;
  argumentsText: string;
  parsedArguments?: Record<string, unknown>;
  pathText?: string;
  resultId?: string;
  resultSizeBytes?: number;
  rawOutputAvailable?: boolean;
  errorCode?: string;
  errorMessage: string;
  durationMs?: number;
  createdAt?: string;
  approvalId?: string;
  approvalTitle?: string;
  approvalDescription?: string;
  permissionType?: ToolPermissionType;
  grantPath?: string;
  grantOrigin?: string;
  approvalIndex?: number;
  approvalCount?: number;
  askQuestions?: AskQuestion[];
  askAnswers?: string[];
};

export type ToolResultLoader = (resultId: string, force?: boolean) => Promise<ToolResultDetail>;

export type AssistantTextPart = {
  type: "text";
  id: string;
  text: string;
};

export type AssistantToolPart = {
  type: "tool";
  id: string;
  toolCall: ToolCallView;
};

export type AssistantPart = AssistantTextPart | AssistantToolPart;

export type ChatMessage = {
  id: string;
  role: MessageRole;
  text: string;
  state?: MessageState;
  turnId?: string | null;
  createdAt?: string;
  modelName?: string;
  parts?: AssistantPart[];
  toolCalls?: ToolCallView[];
};

export type AssistantRenderSegment =
  | { type: "text"; id: string; text: string }
  | { type: "tool_group"; id: string; toolCalls: ToolCallView[] };

export function groupAssistantParts(parts: AssistantPart[]): AssistantRenderSegment[] {
  const segments: AssistantRenderSegment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      segments.push({ type: "text", id: part.id, text: part.text });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.type === "tool_group") {
      last.toolCalls.push(part.toolCall);
      continue;
    }
    segments.push({ type: "tool_group", id: part.id, toolCalls: [part.toolCall] });
  }
  return segments;
}

export function isToolGroupRunning(toolCalls: ToolCallView[]) {
  return toolCalls.some(
    (tool) =>
      tool.status === "started" ||
      tool.status === "waiting_approval" ||
      tool.status === "submitting",
  );
}

export function formatMessageState(state: MessageState) {
  if (state === "streaming") return "生成中";
  if (state === "complete") return "完成";
  if (state === "cancel") return "已取消";
  if (state === "error") return "错误";
  return "提示";
}

export function formatSessionTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
