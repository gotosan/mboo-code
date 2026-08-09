export type SessionStatus = "active" | "archived";
export type SessionListTab = "active" | "archived";

export type SessionInfo = {
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

export type SessionConfirmAction = {
  type: "archive" | "delete";
  id: string;
} | null;
