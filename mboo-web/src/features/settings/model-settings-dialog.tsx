"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, LoaderCircle, Settings2, TriangleAlert, X } from "lucide-react";
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
};

type InterfaceState = "loading" | "ready" | "unavailable";

const EMPTY_DRAFT: ModelSettingsDraft = {
  baseUrl: "",
  apiKey: "",
  clearApiKey: false,
};

/**
 * 提供全局模型服务配置的前端入口；配置写入和热加载交给未来后台接口，页面不在本地伪造成功状态。
 */
export function ModelSettingsDialog({ open, onClose, onModelsRefreshed }: ModelSettingsDialogProps) {
  const [draft, setDraft] = useState<ModelSettingsDraft>(EMPTY_DRAFT);
  const [savedSettings, setSavedSettings] = useState<ModelSettings | null>(null);
  const [interfaceState, setInterfaceState] = useState<InterfaceState>("loading");
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
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
    setShowApiKey(false);

    void getModelSettings()
      .then((settings) => {
        if (cancelled) return;
        setSavedSettings(settings);
        setDraft((current) => ({ ...current, baseUrl: settings.baseUrl }));
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
      if (event.key === "Escape" && !isTesting && !isSaving) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isSaving, isTesting, onClose, open]);

  if (!open) return null;

  const isBusy = isLoading || isTesting || isSaving;
  const canClearApiKey = Boolean(savedSettings?.apiKeyConfigured);
  const statusLabel = interfaceState === "ready" ? "接口已连接" : interfaceState === "loading" ? "正在读取配置" : "等待后台接口";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setNoticeMessage("");
    if (!draft.baseUrl.trim()) {
      setErrorMessage("请填写模型服务 Base URL");
      baseUrlInputRef.current?.focus();
      return;
    }
    if (!savedSettings?.apiKeyConfigured && !draft.apiKey.trim()) {
      setErrorMessage("首次配置请填写 API Key");
      return;
    }

    setIsSaving(true);
    try {
      const settings = await updateModelSettings(draft);
      setSavedSettings(settings);
      setDraft((current) => ({ ...current, apiKey: "", clearApiKey: false, baseUrl: settings.baseUrl }));
      setInterfaceState("ready");
      await onModelsRefreshed?.();
      setNoticeMessage(`配置已保存${typeof settings.modelCount === "number" ? `，已发现 ${settings.modelCount} 个模型` : ""}`);
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setErrorMessage("");
    setNoticeMessage("");
    if (!draft.baseUrl.trim()) {
      setErrorMessage("请先填写模型服务 Base URL");
      baseUrlInputRef.current?.focus();
      return;
    }
    if (!savedSettings?.apiKeyConfigured && !draft.apiKey.trim()) {
      setErrorMessage("首次测试请填写 API Key");
      return;
    }

    setIsTesting(true);
    try {
      const settings = await testModelSettings(draft);
      setNoticeMessage(`连接成功${typeof settings.modelCount === "number" ? `，发现 ${settings.modelCount} 个模型` : ""}`);
      setInterfaceState("ready");
    } catch (error: unknown) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsTesting(false);
    }
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
        className="flex max-h-[min(720px,calc(100dvh-24px))] w-full max-w-[31rem] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-panel shadow-dock"
        role="dialog"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent/25 bg-accent-soft text-accent-strong">
            <Settings2 className="size-[17px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 id="model-settings-title" className="text-[15px] font-semibold tracking-[-0.01em] text-text-1">
                模型服务设置
              </h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${interfaceState === "ready" ? "border-ok/25 bg-ok-soft text-ok" : "border-line bg-panel-muted text-text-3"}`}>
                <span className={`size-1.5 rounded-full ${interfaceState === "ready" ? "bg-ok" : "bg-text-4"}`} aria-hidden />
                {statusLabel}
              </span>
            </div>
            <p id="model-settings-description" className="mt-1 text-[12px] leading-5 text-text-3">
              配置后端模型供应商，保存后刷新当前可用模型。
            </p>
          </div>
          <button
            aria-label="关闭模型服务设置"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-3 transition-colors hover:bg-panel-muted hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isBusy}
            type="button"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <form className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-2" htmlFor="model-settings-base-url">
                Base URL
              </label>
              <input
                ref={baseUrlInputRef}
                autoComplete="url"
                className="h-10 w-full rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3 font-mono text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-focus focus:ring-2 focus:ring-accent/15"
                disabled={isBusy}
                id="model-settings-base-url"
                placeholder="例如 http://localhost:8317/v1"
                spellCheck={false}
                type="url"
                value={draft.baseUrl}
                onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              />
              <p className="mt-1.5 text-[11px] leading-4 text-text-4">支持 OpenAI 兼容接口地址，末尾的斜杠会自动整理。</p>
            </div>

            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-2" htmlFor="model-settings-api-key">
                API Key
              </label>
              <div className="relative">
                <input
                  autoComplete="new-password"
                  className="h-10 w-full rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3 pr-10 font-mono text-[12px] text-text-1 outline-none transition-colors placeholder:text-text-4 focus:border-focus focus:ring-2 focus:ring-accent/15"
                  disabled={isBusy}
                  id="model-settings-api-key"
                  placeholder={savedSettings?.apiKeyConfigured ? "已配置，留空表示不修改" : "输入供应商 API Key"}
                  spellCheck={false}
                  type={showApiKey ? "text" : "password"}
                  value={draft.apiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value, clearApiKey: false }))}
                />
                <button
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-text-4 hover:text-text-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isBusy || !draft.apiKey}
                  type="button"
                  onClick={() => setShowApiKey((current) => !current)}
                >
                  {showApiKey ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] leading-4 text-text-4">
                <span>{savedSettings?.apiKeyConfigured ? `当前：${savedSettings.apiKeyMasked || "已配置（已隐藏）"}` : "Key 只提交给后台接口，不写入浏览器存储。"}</span>
                {canClearApiKey ? (
                  <label className="inline-flex shrink-0 items-center gap-1.5 text-danger">
                    <input
                      checked={draft.clearApiKey}
                      className="size-3 accent-danger"
                      disabled={isBusy || Boolean(draft.apiKey)}
                      type="checkbox"
                      onChange={(event) => setDraft((current) => ({ ...current, clearApiKey: event.target.checked }))}
                    />
                    清除
                  </label>
                ) : null}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-line bg-panel-muted px-3 py-2.5 text-[11px] leading-4 text-text-3">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-text-4" aria-hidden />
              <span>前端不会保存完整 API Key。当前后台配置接口尚未接入时，测试和保存会返回接口错误，不会伪造成功。</span>
            </div>

            {errorMessage ? (
              <p className="flex items-start gap-1.5 text-[12px] leading-5 text-danger" role="alert">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {errorMessage}
              </p>
            ) : null}
            {noticeMessage ? (
              <p className="flex items-start gap-1.5 text-[12px] leading-5 text-ok" role="status">
                <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {noticeMessage}
              </p>
            ) : null}
          </div>

          <footer className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
            <button
              className="h-9 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy}
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-line-strong bg-panel px-3.5 text-[12px] font-medium text-text-2 transition-colors hover:bg-panel-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy || interfaceState === "unavailable"}
              type="button"
              onClick={() => void handleTest()}
            >
              {isTesting ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              测试连接
            </button>
            <button
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent-strong px-3.5 text-[12px] font-medium text-accent-fg transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy || interfaceState === "unavailable"}
              type="submit"
            >
              {isSaving ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
              保存并刷新模型
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "模型设置接口暂不可用";
}
