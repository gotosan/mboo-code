"use client";

import { memo, useState } from "react";
import { ChevronDown, FolderOpen, LoaderCircle, Send, Square, X } from "lucide-react";
import type { ModelContextLimit, ModelInfo, PermissionMode } from "@/lib/session-types";
import styles from "./task-composer.module.css";

export const MANUAL_MODEL_VALUE = "__manual__";

export const REASONING_OPTIONS = [
  { value: "", label: "默认" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

function workspaceBasename(path?: string | null) {
  if (!path) return "";
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

export type TaskComposerProps = {
  input: string;
  onInputChange: (value: string) => void;
  recentInputs: string[];
  isRunning: boolean;
  isCompressing: boolean;
  canCompress: boolean;
  isSessionSwitching: boolean;
  isSelectingWorkspace: boolean;
  modelName: string;
  isManualModel: boolean;
  permissionMode: PermissionMode;
  onPermissionModeChange: (value: PermissionMode) => void;
  onModelChange: (value: string, manual?: boolean) => void;
  modelOptions: string[];
  modelOptionsError: string;
  isLoadingModelOptions: boolean;
  modelInfo: ModelInfo | null;
  modelInfoError: string;
  isLoadingModelInfo: boolean;
  modelContextLimit: ModelContextLimit | null;
  modelContextLimitError: string;
  contextLimitDraft: number | null;
  isLoadingModelContextLimit: boolean;
  isSavingContextLimit: boolean;
  onContextLimitChange: (value: number) => void;
  onSaveContextLimit: () => void;
  onResetContextLimit: () => void;
  reasoningEffort: string;
  onReasoningChange: (value: string) => void;
  workspacePath: string;
  workspaceStatusText: string;
  canSelectWorkspace: boolean;
  canClearWorkspace: boolean;
  onSelectWorkspace: () => void;
  onClearWorkspace: () => void;
  isComposerSettingsOpen: boolean;
  onToggleSettings: () => void;
  onSend: () => void;
  onStop: () => void;
  onCompress: () => void;
  onFocusModelInput: () => void;
};

export const TaskComposer = memo(function TaskComposer({
  input,
  onInputChange,
  recentInputs,
  isRunning,
  isCompressing,
  canCompress,
  isSessionSwitching,
  isSelectingWorkspace,
  modelName,
  isManualModel,
  permissionMode,
  onPermissionModeChange,
  onModelChange,
  modelOptions,
  modelOptionsError,
  isLoadingModelOptions,
  modelInfo,
  modelInfoError,
  isLoadingModelInfo,
  modelContextLimit,
  modelContextLimitError,
  contextLimitDraft,
  isLoadingModelContextLimit,
  isSavingContextLimit,
  onContextLimitChange,
  onSaveContextLimit,
  onResetContextLimit,
  reasoningEffort,
  onReasoningChange,
  workspacePath,
  workspaceStatusText,
  canSelectWorkspace,
  canClearWorkspace,
  onSelectWorkspace,
  onClearWorkspace,
  isComposerSettingsOpen,
  onToggleSettings,
  onSend,
  onStop,
  onCompress,
  onFocusModelInput,
}: TaskComposerProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const workspaceLabel = workspaceBasename(workspacePath) || workspaceStatusText;
  const canSend = Boolean(input.trim() && modelName.trim() && !isRunning && !isCompressing && !isSessionSwitching && !isSelectingWorkspace);

  const submit = () => {
    if (!canSend) return;
    setSuggestOpen(false);
    setSuggestIndex(-1);
    onSend();
  };

  const applyHistory = (value: string) => {
    setSuggestOpen(false);
    setSuggestIndex(-1);
    onInputChange(value);
  };

  return (
    <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {!modelName.trim() ? (
        <div className={styles.warning} role="status">
          <span>请先填写模型名称后再发送</span>
          <button className={styles.warningAction} type="button" onClick={onFocusModelInput}>去填写</button>
        </div>
      ) : null}

      {!isRunning ? (
        <>
          <button
            className={styles.mobileSettingsToggle}
            type="button"
            aria-expanded={isComposerSettingsOpen || !modelName.trim()}
            onClick={onToggleSettings}
          >
            <span className={styles.mobileSettingsLabel}>任务设置 · {modelName.trim() || "未填模型"} · {workspaceLabel}</span>
            <ChevronDown className={`${styles.mobileChevron} ${isComposerSettingsOpen || !modelName.trim() ? "" : styles.mobileChevronCollapsed}`} aria-hidden />
          </button>
          <div className={`${styles.configBar} ${isComposerSettingsOpen || !modelName.trim() ? "" : styles.configBarClosed}`}>
            <div className={styles.configGroup}>
              <label className={styles.configLabel} htmlFor="model-select">模型</label>
              <select className={styles.configSelect} id="model-select" value={isManualModel ? MANUAL_MODEL_VALUE : modelName} onChange={(event) => onModelChange(event.target.value, event.target.value === MANUAL_MODEL_VALUE)}>
                {modelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                <option value={MANUAL_MODEL_VALUE}>手动输入</option>
              </select>
              {isManualModel ? (
                <input className={styles.manualModelInput} id="model-input" aria-label="手动模型名称" autoComplete="off" placeholder="例如 gpt-4.1" value={modelName} onChange={(event) => onModelChange(event.target.value, true)} />
              ) : null}
              <span className={`${styles.configHint} ${modelOptionsError ? styles.configHintError : ""}`} title={modelOptionsError}>
                {isLoadingModelOptions ? "加载中" : modelOptionsError ? "候选失败，可手动填写" : modelOptions.length ? `${modelOptions.length} 个候选` : "暂无候选"}
              </span>
            </div>
            <span className={styles.divider} aria-hidden />
            <div className={styles.configGroup}>
              <label className={styles.configLabel} htmlFor="reasoning-select">推理</label>
              <select className={styles.configSelect} id="reasoning-select" value={reasoningEffort} onChange={(event) => onReasoningChange(event.target.value)}>
                {REASONING_OPTIONS.map((option) => <option key={option.value || "default"} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <span className={styles.spacer} aria-hidden />
            <div className={styles.workspaceGroup}>
              <span className={styles.workspaceLabel}>工作区</span>
              <span className={styles.workspacePath} title={workspacePath || workspaceStatusText}>{workspaceLabel}</span>
              {canSelectWorkspace ? (
                <button className={styles.composerButton} disabled={isSelectingWorkspace} type="button" onClick={onSelectWorkspace}>
                  {isSelectingWorkspace ? <LoaderCircle className={styles.icon} aria-hidden /> : <FolderOpen className={styles.icon} aria-hidden />}选择目录
                </button>
              ) : null}
              {canClearWorkspace ? (
                <button className={styles.composerButton} type="button" onClick={onClearWorkspace}><X className={styles.icon} aria-hidden />清除</button>
              ) : null}
            </div>
          </div>
          {isComposerSettingsOpen ? (
            <div className={styles.modelMetaPanel} aria-label="模型能力与上下文设置">
              <div className={styles.modelMetaHeader}>
                <div className={styles.modelMetaTitleGroup}>
                  <span className={styles.modelMetaTitle}>模型能力</span>
                  {isLoadingModelInfo ? <span className={styles.modelMetaHint}>读取中</span> : null}
                  {!isLoadingModelInfo && modelInfoError ? <span className={styles.modelMetaError} title={modelInfoError}>能力未读取</span> : null}
                  {!isLoadingModelInfo && !modelInfoError && modelInfo ? (
                    <span className={styles.modelMetaHint}>{modelInfo.toolCall ? "支持工具" : "无工具"} · {modelInfo.reasoning ? "支持推理" : "标准响应"}</span>
                  ) : null}
                </div>
                <label className={styles.permissionControl}>
                  <span>权限</span>
                  <select
                    className={styles.permissionSelect}
                    aria-label="会话权限模式"
                    value={permissionMode}
                    onChange={(event) => onPermissionModeChange(event.target.value as PermissionMode)}
                  >
                    <option value="DEFAULT">默认审批</option>
                    <option value="FULL_ACCESS">完全访问</option>
                  </select>
                </label>
                {modelContextLimit ? (
                  <span className={styles.contextLimitValue}>
                    {formatTokenCount(contextLimitDraft ?? modelContextLimit.effectiveContextLimit)} 上限
                  </span>
                ) : null}
              </div>
              {isLoadingModelContextLimit ? (
                <p className={styles.modelMetaHint}>正在读取上下文窗口配置…</p>
              ) : modelContextLimitError ? (
                <p className={styles.modelMetaError} title={modelContextLimitError}>上下文窗口配置读取失败，保留当前模型选择。</p>
              ) : modelContextLimit ? (
                <div className={styles.contextLimitRow}>
                  <input
                    className={styles.contextLimitRange}
                    type="range"
                    min={modelContextLimit.minimumContextLimit}
                    max={modelContextLimit.maximumContextLimit}
                    step={contextLimitStep(modelContextLimit)}
                    value={contextLimitDraft ?? modelContextLimit.effectiveContextLimit}
                    disabled={!modelContextLimit.adjustable || isSavingContextLimit}
                    aria-label="上下文窗口上限"
                    onChange={(event) => onContextLimitChange(Number(event.target.value))}
                  />
                  <span className={styles.contextLimitRangeLabel}>{formatTokenCount(modelContextLimit.minimumContextLimit)}</span>
                  <span className={styles.contextLimitRangeLabel}>{formatTokenCount(modelContextLimit.maximumContextLimit)}</span>
                  {modelContextLimit.adjustable ? (
                    <div className={styles.contextLimitActions}>
                      <button
                        className={styles.composerButton}
                        disabled={isSavingContextLimit || contextLimitDraft === null || contextLimitDraft === modelContextLimit.effectiveContextLimit}
                        type="button"
                        onClick={onSaveContextLimit}
                      >
                        {isSavingContextLimit ? "保存中" : "保存上限"}
                      </button>
                      <button
                        className={styles.contextResetButton}
                        disabled={isSavingContextLimit || !modelContextLimit.configuredContextLimit}
                        type="button"
                        onClick={onResetContextLimit}
                      >
                        恢复默认
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className={styles.modelMetaHint}>当前模型暂时没有可配置的上下文窗口。</p>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      <div className={styles.composer}>
        <div className={styles.toolbar}>
          <button className={`${styles.composerButton} ${styles.toolbarButton}`} type="button" disabled={!input.trim() || isRunning} onClick={() => onInputChange("")}>清空</button>
          <span className={styles.toolbarHint}>{isRunning ? "生成中，Esc 可停止" : isCompressing ? "上下文压缩中" : "Enter 发送 · Shift+Enter 换行"}</span>
        </div>
        <label className="sr-only" htmlFor="task-input">任务输入</label>
        <div className={styles.editor}>
          <textarea
            className={styles.textarea}
            id="task-input"
            disabled={isRunning || isCompressing || isSessionSwitching || isSelectingWorkspace}
            placeholder="写下任务目标，或继续追问…"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                submit();
                return;
              }
              if (!recentInputs.length) return;
              if (event.key === "ArrowUp") {
                event.preventDefault();
                const next = suggestIndex < 0 ? 0 : Math.min(suggestIndex + 1, recentInputs.length - 1);
                setSuggestOpen(true);
                setSuggestIndex(next);
                onInputChange(recentInputs[next]);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                const next = suggestIndex - 1;
                if (next < 0) {
                  setSuggestOpen(false);
                  setSuggestIndex(-1);
                } else {
                  setSuggestIndex(next);
                  onInputChange(recentInputs[next]);
                }
              }
            }}
          />
        </div>
        {suggestOpen && recentInputs.length ? (
          <div className={styles.suggestions} role="listbox" aria-label="最近输入历史">
            {recentInputs.map((item, index) => (
              <button
                className={`${styles.suggestionRow} ${index === suggestIndex ? styles.suggestionRowSelected : ""}`}
                key={`${item}-${index}`}
                type="button"
                role="option"
                aria-selected={index === suggestIndex}
                onMouseDown={(event) => { event.preventDefault(); applyHistory(item); }}
              >
                {index === suggestIndex ? <span className={styles.suggestionBar} aria-hidden /> : null}
                <span className={styles.suggestionText}>{item}</span>
              </button>
            ))}
            <span className={styles.suggestionHint}>↑↓ 选择 · Enter 确认</span>
          </div>
        ) : null}
        <div className={styles.statusbar}>
          <span className={styles.statusText}>{workspaceLabel}{modelName.trim() ? ` · ${modelName.trim()}` : ""}</span>
          <div className={styles.statusActions}>
            {isRunning ? (
              <button className={`${styles.composerButton} ${styles.stopButton}`} type="button" onClick={onStop}><Square className={styles.icon} aria-hidden />停止</button>
            ) : (
              <>
                {canCompress ? (
                  <button className={styles.composerButton} type="button" onClick={isCompressing ? onStop : onCompress}>
                    {isCompressing ? "停止压缩" : "压缩上下文"}
                  </button>
                ) : null}
                <button className={`${styles.primaryButton} ${!canSend ? styles.lockedButton : ""}`} disabled={!canSend} type="submit" title={!modelName.trim() ? "请先填写模型名称" : !input.trim() ? "请先输入任务" : "发送（Enter）"}>
                  <Send className={styles.icon} aria-hidden />发送
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});

function contextLimitStep(limit: ModelContextLimit) {
  const span = limit.maximumContextLimit - limit.minimumContextLimit;
  return Math.max(1_000, Math.round(span / 100));
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  }
  return String(value);
}
