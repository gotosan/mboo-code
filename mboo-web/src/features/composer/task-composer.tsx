"use client";

import { memo, useState } from "react";
import { ChevronDown, FolderOpen, LoaderCircle, Send, Square, X } from "lucide-react";
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
  isSessionSwitching: boolean;
  isSelectingWorkspace: boolean;
  modelName: string;
  isManualModel: boolean;
  onModelChange: (value: string, manual?: boolean) => void;
  modelOptions: string[];
  modelOptionsError: string;
  isLoadingModelOptions: boolean;
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
  onFocusModelInput: () => void;
};

export const TaskComposer = memo(function TaskComposer({
  input,
  onInputChange,
  recentInputs,
  isRunning,
  isSessionSwitching,
  isSelectingWorkspace,
  modelName,
  isManualModel,
  onModelChange,
  modelOptions,
  modelOptionsError,
  isLoadingModelOptions,
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
  onFocusModelInput,
}: TaskComposerProps) {
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(-1);
  const workspaceLabel = workspaceBasename(workspacePath) || workspaceStatusText;
  const canSend = Boolean(input.trim() && modelName.trim() && !isRunning && !isSessionSwitching && !isSelectingWorkspace);

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
        </>
      ) : null}

      <div className={styles.composer}>
        <div className={styles.toolbar}>
          <button className={`${styles.composerButton} ${styles.toolbarButton}`} type="button" disabled={!input.trim() || isRunning} onClick={() => onInputChange("")}>清空</button>
          <span className={styles.toolbarHint}>{isRunning ? "生成中，Esc 可停止" : "Enter 发送 · Shift+Enter 换行"}</span>
        </div>
        <label className="sr-only" htmlFor="task-input">任务输入</label>
        <div className={styles.editor}>
          <textarea
            className={styles.textarea}
            id="task-input"
            disabled={isRunning || isSessionSwitching || isSelectingWorkspace}
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
              <button className={`${styles.primaryButton} ${!canSend ? styles.lockedButton : ""}`} disabled={!canSend} type="submit" title={!modelName.trim() ? "请先填写模型名称" : !input.trim() ? "请先输入任务" : "发送（Enter）"}>
                <Send className={styles.icon} aria-hidden />发送
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});
