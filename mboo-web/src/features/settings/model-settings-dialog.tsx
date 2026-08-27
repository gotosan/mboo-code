"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, Plus, RotateCcw, Settings2, Trash2, TriangleAlert, X } from "lucide-react";
import {
  getModelSettings,
  testModelSettings,
  updateModelSettings,
  type ModelSettings,
  type ModelSettingsDraft,
} from "@/lib/model-settings-api";

type ModelSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  onModelsRefreshed?: () => Promise<void>;
  hasRunningTask?: boolean;
  onCancelRunningTask?: () => void | Promise<void>;
};

type InterfaceState = "loading" | "ready" | "unavailable";

const DEFAULT_IGNORED_FILE_PATTERNS = [
  ".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
  "credentials.json", "credentials.yml", "credentials.yaml", "secrets.json", "secrets.yml", "secrets.yaml",
];
const DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS = [".env.example", ".env.template", ".env.sample"];
const EMPTY_DRAFT: ModelSettingsDraft = {
  baseUrl: "",
  apiKey: "",
  clearApiKey: false,
  webSearchExaApiKey: "",
  clearWebSearchExaApiKey: false,
  webFetchPrivateNetworkEnabled: false,
  ignoredFilePatterns: DEFAULT_IGNORED_FILE_PATTERNS,
  ignoredFilePatternExceptions: DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS,
};

const STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: "未配置",
  CONNECTION_FAILED: "连接失败",
  CONNECTED: "已连接",
  RESTART_REQUIRED: "配置更新重启后生效",
};

/**
 * 管理全局 setting.json；保存只写入磁盘，供应商和其他配置统一在重启后由后端重新加载。
 */
export function ModelSettingsDialog({ open, onClose, onModelsRefreshed, hasRunningTask = false, onCancelRunningTask }: ModelSettingsDialogProps) {
  const [draft, setDraft] = useState<ModelSettingsDraft>(EMPTY_DRAFT);
  const [savedSettings, setSavedSettings] = useState<ModelSettings | null>(null);
  const [interfaceState, setInterfaceState] = useState<InterfaceState>("loading");
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showExaApiKey, setShowExaApiKey] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const baseUrlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setDraft(EMPTY_DRAFT);
    setSavedSettings(null);
    setInterfaceState("loading");
    setIsLoading(true);
    setErrorMessage("");
    setNoticeMessage("");
    setConfirmRestart(false);
    setShowApiKey(false);
    setShowExaApiKey(false);

    void getModelSettings()
      .then((settings) => {
        if (cancelled) return;
        setSavedSettings(settings);
        setDraft(toDraft(settings));
        setInterfaceState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInterfaceState("unavailable");
        setErrorMessage(toErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    window.requestAnimationFrame(() => baseUrlInputRef.current?.focus());
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isTesting && !isSaving && !isRestarting) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isRestarting, isSaving, isTesting, onClose, open]);

  if (!open) return null;

  const isBusy = isLoading || isTesting || isSaving || isRestarting;
  const canClearApiKey = Boolean(savedSettings?.apiKeyConfigured);
  const canClearExaApiKey = Boolean(savedSettings?.webSearchExaApiKeyConfigured);
  const canRestart = typeof window !== "undefined" && Boolean((window as Window & { mbooDesktop?: { restartApp?: () => Promise<boolean> } }).mbooDesktop?.restartApp);
  const statusCode = savedSettings?.status || (interfaceState === "unavailable" ? "CONNECTION_FAILED" : "NOT_CONFIGURED");
  const statusLabel = STATUS_LABELS[statusCode] || savedSettings?.statusMessage || "正在读取配置";
  const statusMessage = savedSettings?.statusMessage || statusLabel;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setNoticeMessage("");
    setConfirmRestart(false);
    try {
      validateBaseUrl(draft.baseUrl);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
      baseUrlInputRef.current?.focus();
      return;
    }

    setIsSaving(true);
    try {
      const settings = await updateModelSettings(draft);
      setSavedSettings(settings);
      setDraft((current) => ({
        ...current,
        apiKey: "",
        clearApiKey: false,
        webSearchExaApiKey: "",
        clearWebSearchExaApiKey: false,
        baseUrl: settings.baseUrl,
        webFetchPrivateNetworkEnabled: settings.webFetchPrivateNetworkEnabled ?? current.webFetchPrivateNetworkEnabled,
        ignoredFilePatterns: settings.ignoredFilePatterns ?? current.ignoredFilePatterns,
        ignoredFilePatternExceptions: settings.ignoredFilePatternExceptions ?? current.ignoredFilePatternExceptions,
      }));
      setInterfaceState("ready");
      if (!settings.restartRequired) await onModelsRefreshed?.();
      setNoticeMessage(settings.restartRequired ? "配置已保存，配置更新重启后生效" : `配置已保存${typeof settings.modelCount === "number" ? `，当前有 ${settings.modelCount} 个可用模型` : ""}`);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setErrorMessage("");
    setNoticeMessage("");
    if (!draft.baseUrl.trim() || (!savedSettings?.apiKeyConfigured && !draft.apiKey.trim())) {
      setErrorMessage("测试连接需要同时填写模型服务 Base URL 和 API Key");
      return;
    }
    try {
      validateBaseUrl(draft.baseUrl);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
      return;
    }

    setIsTesting(true);
    try {
      const settings = await testModelSettings(draft);
      setNoticeMessage(`连接成功${typeof settings.modelCount === "number" ? `，发现 ${settings.modelCount} 个模型` : ""}`);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsTesting(false);
    }
  };

  const handleRestart = async () => {
    if (!savedSettings?.restartRequired) return;
    if (!canRestart) {
      setNoticeMessage("当前浏览器模式无法自动重启，请手动重启后端。");
      return;
    }
    if (hasRunningTask && !confirmRestart) {
      setConfirmRestart(true);
      return;
    }
    setIsRestarting(true);
    setErrorMessage("");
    try {
      await onCancelRunningTask?.();
      const bridge = (window as Window & { mbooDesktop?: { restartApp?: () => Promise<boolean> } }).mbooDesktop;
      if (!bridge?.restartApp || !(await bridge.restartApp())) throw new Error("桌面应用重启请求未执行");
    } catch (error: unknown) {
      setIsRestarting(false);
      setConfirmRestart(false);
      setErrorMessage(toErrorMessage(error));
    }
  };

  const handleRestoreDefaults = () => {
    setDraft((current) => ({
      ...current,
      webSearchExaApiKey: "",
      clearWebSearchExaApiKey: false,
      webFetchPrivateNetworkEnabled: false,
      ignoredFilePatterns: [...DEFAULT_IGNORED_FILE_PATTERNS],
      ignoredFilePatternExceptions: [...DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS],
    }));
    setErrorMessage("");
    setNoticeMessage("本页默认值已恢复，点击保存后写入配置");
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-text-1/35 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        aria-describedby="model-settings-description"
        aria-labelledby="model-settings-title"
        aria-modal="true"
        className="flex max-h-[min(780px,calc(100dvh-24px))] w-full max-w-[34rem] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-dock"
        role="dialog"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent/25 bg-accent-soft text-accent-strong">
            <Settings2 className="size-[17px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="model-settings-title" className="text-[15px] font-semibold tracking-[-0.01em] text-text-1">模型服务设置</h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${statusCode === "CONNECTED" ? "border-ok/25 bg-ok-soft text-ok" : statusCode === "CONNECTION_FAILED" ? "border-danger/25 bg-danger-soft text-danger" : "border-line bg-panel-muted text-text-3"}`}>
                <span className={`size-1.5 rounded-full ${statusCode === "CONNECTED" ? "bg-ok" : statusCode === "CONNECTION_FAILED" ? "bg-danger" : "bg-text-4"}`} aria-hidden />
                {interfaceState === "loading" ? "正在读取配置" : statusLabel}
              </span>
            </div>
            <p id="model-settings-description" className="mt-1 text-[12px] leading-5 text-text-3">{interfaceState === "loading" ? "" : statusMessage}</p>
          </div>
          <button aria-label="关闭模型服务设置" className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-3 transition-colors hover:bg-panel-muted hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy} type="button" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <form className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-5">
            <section className="space-y-4">
              <div>
                <h3 className="text-[12px] font-semibold text-text-1">模型服务</h3>
                <p className="mt-1 text-[11px] leading-4 text-text-4">兼容 OpenAI Responses API 的服务地址和访问密钥。</p>
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-text-2" htmlFor="model-settings-base-url">Base URL</label>
                <input ref={baseUrlInputRef} autoComplete="url" className="h-10 w-full rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3 font-mono text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-focus focus:ring-2 focus:ring-accent/15" disabled={isBusy || interfaceState === "unavailable"} id="model-settings-base-url" placeholder="例如 http://localhost:8317/v1" spellCheck={false} type="url" value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} />
                <p className="mt-1.5 text-[11px] leading-4 text-text-4">可留空表示未配置，末尾斜杠会自动整理。</p>
              </div>
              <SecretField id="model-settings-api-key" label="API Key" value={draft.apiKey} configured={canClearApiKey} masked={savedSettings?.apiKeyMasked} visible={showApiKey} disabled={isBusy || interfaceState === "unavailable"} clear={draft.clearApiKey} onChange={(value) => setDraft((current) => ({ ...current, apiKey: value, clearApiKey: false }))} onToggle={() => setShowApiKey((current) => !current)} onClearChange={(value) => setDraft((current) => ({ ...current, clearApiKey: value }))} />
            </section>

            <section className="space-y-4 border-t border-line pt-5">
              <div>
                <h3 className="text-[12px] font-semibold text-text-1">网络能力</h3>
              </div>
              <SecretField id="model-settings-exa-api-key" label="Exa API Key" value={draft.webSearchExaApiKey || ""} configured={canClearExaApiKey} masked={savedSettings?.webSearchExaApiKeyMasked} visible={showExaApiKey} disabled={isBusy || interfaceState === "unavailable"} clear={Boolean(draft.clearWebSearchExaApiKey)} onChange={(value) => setDraft((current) => ({ ...current, webSearchExaApiKey: value, clearWebSearchExaApiKey: false }))} onToggle={() => setShowExaApiKey((current) => !current)} onClearChange={(value) => setDraft((current) => ({ ...current, clearWebSearchExaApiKey: value }))} />
              <label className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-line bg-panel-muted px-3 py-2.5 text-[12px] text-text-2">
                <input checked={Boolean(draft.webFetchPrivateNetworkEnabled)} className="mt-0.5 size-3.5 accent-accent-strong" disabled={isBusy || interfaceState === "unavailable"} type="checkbox" onChange={(event) => setDraft((current) => ({ ...current, webFetchPrivateNetworkEnabled: event.target.checked }))} />
                <span><span className="block font-medium">允许网页抓取访问私有网络</span><span className="mt-0.5 block text-[11px] leading-4 text-text-4">只影响网页抓取能力，具体来源仍需会话授权。</span></span>
              </label>
            </section>

            <RuleEditor label="全局忽略文件规则" rules={draft.ignoredFilePatterns || []} disabled={isBusy || interfaceState === "unavailable"} onChange={(rules) => setDraft((current) => ({ ...current, ignoredFilePatterns: rules }))} />
            <RuleEditor label="全局忽略文件例外规则" rules={draft.ignoredFilePatternExceptions || []} disabled={isBusy || interfaceState === "unavailable"} onChange={(rules) => setDraft((current) => ({ ...current, ignoredFilePatternExceptions: rules }))} />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <button className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-2.5 text-[11px] font-medium text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy || interfaceState === "unavailable"} type="button" onClick={handleRestoreDefaults}><RotateCcw className="size-3.5" aria-hidden />恢复本页默认值</button>
              {typeof savedSettings?.unknownFieldCount === "number" && savedSettings.unknownFieldCount > 0 ? <span className="text-[11px] text-text-4">存在 {savedSettings.unknownFieldCount} 个未管理字段，保存时会保留。</span> : null}
            </div>

            {errorMessage ? <p className="flex items-start gap-1.5 text-[12px] leading-5 text-danger" role="alert"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />{errorMessage}</p> : null}
            {noticeMessage ? <p className="flex items-start gap-1.5 text-[12px] leading-5 text-ok" role="status"><Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />{noticeMessage}</p> : null}
            {confirmRestart ? <div className="rounded-[var(--radius-sm)] border border-danger/25 bg-danger-soft px-3 py-2.5 text-[11px] leading-4 text-danger"><p>当前有运行中的任务。确认重启会取消当前任务，并使等待中的授权请求失效。</p><div className="mt-2 flex justify-end gap-2"><button className="h-7 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-2.5 text-[11px] text-text-2" disabled={isBusy} type="button" onClick={() => setConfirmRestart(false)}>取消</button><button className="h-7 rounded-[var(--radius-sm)] bg-danger px-2.5 text-[11px] font-medium text-white" disabled={isBusy} type="button" onClick={() => void handleRestart()}>确认重启</button></div></div> : null}
          </div>

          <footer className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button className="h-9 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy} type="button" onClick={onClose}>关闭</button>
            {savedSettings?.restartRequired && canRestart ? <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-danger/40 bg-danger-soft px-3.5 text-[12px] font-medium text-danger transition-colors hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy} type="button" onClick={() => void handleRestart()}>{isRestarting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}立即重启</button> : null}
            <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy || interfaceState === "unavailable"} type="button" onClick={() => void handleTest()}>{isTesting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}测试连接</button>
            <button className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent-strong px-3.5 text-[12px] font-medium text-accent-fg transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy || interfaceState === "unavailable"} type="submit">{isSaving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}保存配置</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SecretField({ id, label, value, configured, masked, visible, disabled, clear, onChange, onToggle, onClearChange }: { id: string; label: string; value: string; configured: boolean; masked?: string; visible: boolean; disabled: boolean; clear: boolean; onChange: (value: string) => void; onToggle: () => void; onClearChange: (value: boolean) => void }) {
  return <div><label className="mb-1.5 block text-[12px] font-medium text-text-2" htmlFor={id}>{label}</label><div className="relative"><input autoComplete="new-password" className="h-10 w-full rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3 pr-10 font-mono text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-focus focus:ring-2 focus:ring-accent/15" disabled={disabled} id={id} placeholder={configured ? "已配置，留空表示不修改" : "可留空"} spellCheck={false} type={visible ? "text" : "password"} value={value} onChange={(event) => onChange(event.target.value)} /><button aria-label={visible ? `隐藏 ${label}` : `显示 ${label}`} className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-text-4 hover:text-text-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled || !value} type="button" onClick={onToggle}>{visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}</button></div><div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] leading-4 text-text-4"><span>{configured ? `当前：${masked || "已配置（已隐藏）"}` : "Key 不写入浏览器存储。"}</span>{configured ? <label className="inline-flex shrink-0 items-center gap-1.5 text-danger"><input checked={clear} className="size-3 accent-danger" disabled={disabled || Boolean(value)} type="checkbox" onChange={(event) => onClearChange(event.target.checked)} />清除</label> : null}</div></div>;
}

function RuleEditor({ label, rules, disabled, onChange }: { label: string; rules: string[]; disabled: boolean; onChange: (rules: string[]) => void }) {
  return <section className="space-y-2 border-t border-line pt-5"><div className="flex items-center justify-between gap-2"><div><h3 className="text-[12px] font-semibold text-text-1">{label}</h3><p className="mt-1 text-[11px] leading-4 text-text-4">每行一条 glob 规则，空行保存时会移除。</p></div><button aria-label={`添加${label}`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-line-strong bg-panel text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={() => onChange([...rules, ""])}><Plus className="size-4" aria-hidden /></button></div><div className="space-y-1.5">{rules.length ? rules.map((rule, index) => <div className="flex items-center gap-1.5" key={`${label}-${index}`}><input className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-2.5 font-mono text-[11px] text-text-1 outline-none focus:border-focus focus:ring-2 focus:ring-accent/15" disabled={disabled} value={rule} onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button aria-label={`删除${label}第 ${index + 1} 条`} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-4 transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="button" onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-3.5" aria-hidden /></button></div>) : <p className="rounded-[var(--radius-sm)] border border-dashed border-line-strong px-3 py-2 text-[11px] text-text-4">暂无规则</p>}</div></section>;
}

function toDraft(settings: ModelSettings): ModelSettingsDraft {
  return { baseUrl: settings.baseUrl, apiKey: "", clearApiKey: false, webSearchExaApiKey: "", clearWebSearchExaApiKey: false, webFetchPrivateNetworkEnabled: settings.webFetchPrivateNetworkEnabled ?? false, ignoredFilePatterns: settings.ignoredFilePatterns ? [...settings.ignoredFilePatterns] : [...DEFAULT_IGNORED_FILE_PATTERNS], ignoredFilePatternExceptions: settings.ignoredFilePatternExceptions ? [...settings.ignoredFilePatternExceptions] : [...DEFAULT_IGNORED_FILE_PATTERN_EXCEPTIONS] };
}

function validateBaseUrl(value: string) {
  const cleaned = value.trim().replace(/\/+$/, "");
  if (!cleaned) return;
  const url = new URL(cleaned);
  if (!(url.protocol === "http:" || url.protocol === "https:") || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error("模型服务 Base URL 必须是合法的 http/https 地址，且不能包含凭据、查询参数或片段");
}

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "模型设置接口暂不可用";
}
