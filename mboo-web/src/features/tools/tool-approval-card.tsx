"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { ToolCallView } from "@/features/agent-run/message-model";
import {
  getToolLabel,
  toolStatusLabel,
} from "@/features/tools/tool-formatters";
import type { ToolApprovalDecision } from "@/lib/session-types";
import styles from "./tool-approval-card.module.css";

type ToolApprovalCardProps = {
  toolCall: ToolCallView;
  onResolveApproval: (
    toolCall: ToolCallView,
    decision: ToolApprovalDecision,
  ) => Promise<void>;
};

export const ToolApprovalCard = memo(function ToolApprovalCard({
  toolCall,
  onResolveApproval,
}: ToolApprovalCardProps) {
  const submitting = toolCall.status === "submitting";
  const [hasDecisionImpact, setHasDecisionImpact] = useState(false);
  const previousStatusRef = useRef(toolCall.status);

  useEffect(() => {
    // 授权提交后进入 submitting，给用户一次明确的“已接收”反馈；失败回到等待态时不播放成功效果。
    const shouldPlayImpact = toolCall.status === "submitting" && previousStatusRef.current === "waiting_approval";
    previousStatusRef.current = toolCall.status;
    if (!shouldPlayImpact) return;

    setHasDecisionImpact(true);
    const timer = window.setTimeout(() => setHasDecisionImpact(false), 320);
    return () => window.clearTimeout(timer);
  }, [toolCall.status]);

  return (
    <div className={`${styles.card} ${hasDecisionImpact ? styles.decisionImpact : ""}`} role="region" aria-label="工具授权请求">
      {/* 授权后的确认光晕是叠加层，不改变 dock 内卡片的高度。 */}
      {hasDecisionImpact ? <span aria-hidden className={styles.decisionBurst} /> : null}
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <p className={styles.title}>{toolCall.approvalTitle || "需要工具授权"}</p>
          <p className={styles.meta}>
            <span className={styles.metaText}>{approvalTargetLabel(toolCall)}</span>
          </p>
        </div>
        <span className={`${styles.status} ${statusClassName(toolCall.status)}`}>
          {toolCall.status === "waiting_approval" ? <span aria-hidden className={styles.waitingDot} /> : null}
          {toolStatusLabel(toolCall.status)}
        </span>
      </div>

      {/* 长命令只在详情槽内滚动，标题和底部决策区始终保持可见。 */}
      <div className={styles.details}>
        {toolCall.approvalDescription ? <p className={styles.description}>{toolCall.approvalDescription}</p> : null}
        {typeof toolCall.approvalIndex === "number" && typeof toolCall.approvalCount === "number" ? (
          <p className={styles.stage}>授权阶段 {toolCall.approvalIndex}/{toolCall.approvalCount}</p>
        ) : null}
        {toolCall.permissionType === "COMMAND" && typeof toolCall.parsedArguments?.command === "string" ? (
          <div className={styles.valueBox}>
            <pre className={styles.valueText}>{toolCall.parsedArguments.command}</pre>
          </div>
        ) : null}
        {toolCall.grantPath && (toolCall.permissionType === "READ" || toolCall.permissionType === "WRITE") ? (
          <div className={styles.valueBox}>
            <p className={styles.valueText}>{toolCall.grantPath}</p>
            <p className={styles.pathNote}>包含其子目录</p>
          </div>
        ) : null}
        {toolCall.grantOrigin && toolCall.permissionType === "NETWORK" ? (
          <div className={styles.valueBox}>
            <p className={styles.valueText}>{toolCall.grantOrigin}</p>
            <p className={styles.pathNote}>只授权该协议、主机和端口，不包含其他来源</p>
          </div>
        ) : null}
        {toolCall.errorMessage ? <p className={styles.error}>{toolCall.errorMessage}</p> : null}
      </div>

      <div className={styles.actions}>
        <button
          className={`${styles.action} ${styles.allowOnce}`}
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "ALLOW_ONCE")}
        >
          仅允许本次
        </button>
        <button
          className={`${styles.action} ${styles.allowSession}`}
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "ALLOW_SESSION")}
        >
          {sessionAllowLabel(toolCall.permissionType)}
        </button>
        <button
          className={`${styles.action} ${styles.deny}`}
          disabled={submitting}
          type="button"
          onClick={() => void onResolveApproval(toolCall, "DENY")}
        >
          拒绝
        </button>
      </div>
      {toolCall.permissionType === "COMMAND" ? (
        <p className={styles.commandNote}>本会话授权只匹配完全相同的命令、工作目录和 Shell 身份</p>
      ) : null}
    </div>
  );
});

function approvalTargetLabel(toolCall: ToolCallView) {
  if (toolCall.permissionType === "COMMAND" && typeof toolCall.parsedArguments?.command === "string") {
    return `执行命令 · ${toolCall.parsedArguments.command}`;
  }
  if (toolCall.permissionType === "READ") return `读取目录 · ${toolCall.grantPath || toolCall.pathText || toolLabel(toolCall)}`;
  if (toolCall.permissionType === "WRITE") return `读写目录 · ${toolCall.grantPath || toolCall.pathText || toolLabel(toolCall)}`;
  if (toolCall.permissionType === "NETWORK") return `私有网络来源 · ${toolCall.grantOrigin || toolCall.pathText || toolLabel(toolCall)}`;
  return toolCall.pathText ? `${toolLabel(toolCall)} · ${toolCall.pathText}` : toolLabel(toolCall);
}

function toolLabel(toolCall: ToolCallView) {
  return getToolLabel(toolCall.toolName);
}

function statusClassName(status: ToolCallView["status"]) {
  if (status === "waiting_approval") return styles.statusWaiting;
  if (status === "submitting") return styles.statusSubmitting;
  if (status === "started") return styles.statusStarted;
  if (status === "completed") return styles.statusCompleted;
  return styles.statusFailed;
}

function sessionAllowLabel(permissionType?: ToolCallView["permissionType"]) {
  if (permissionType === "READ") return "本会话允许读取此目录";
  if (permissionType === "WRITE") return "本会话允许读写此目录";
  if (permissionType === "COMMAND") return "本会话允许此命令";
  if (permissionType === "NETWORK") return "本会话允许访问此网络来源";
  return "本会话始终允许此工具";
}
