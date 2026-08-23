export type ModelSettings = {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  modelCount?: number;
};

export type ModelSettingsDraft = {
  baseUrl: string;
  apiKey: string;
  clearApiKey: boolean;
};

export type ModelSettingsUpdate = {
  baseUrl: string;
  apiKey?: string;
  clearApiKey?: true;
};

type ApiEnvelope<T> = {
  data?: T;
  message?: string;
  msg?: string;
  error?: string;
};

type Requester = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MODEL_SETTINGS_ENDPOINT = "/api/model/settings";

/**
 * 将模型服务配置收敛为前端可安全展示的字段，阻止后端误返回的完整 API Key 进入页面状态。
 */
export function extractModelSettings(value: unknown): ModelSettings {
  const envelope = isRecord(value) && "data" in value ? value.data : value;
  const source = isRecord(envelope) ? envelope : {};
  return {
    baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
    apiKeyConfigured: source.apiKeyConfigured === true,
    ...(typeof source.apiKeyMasked === "string" ? { apiKeyMasked: source.apiKeyMasked } : {}),
    ...(typeof source.modelCount === "number" ? { modelCount: source.modelCount } : {}),
  };
}

/**
 * 只把用户明确输入的字段提交给未来的后台配置接口，空 API Key 默认表示保持原值。
 */
export function buildModelSettingsUpdate(draft: ModelSettingsDraft): ModelSettingsUpdate {
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = draft.apiKey.trim();
  return {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(draft.clearApiKey ? { clearApiKey: true } : {}),
  };
}

/**
 * 通过 Next.js 同源代理获取配置，保持浏览器页面不直接连接 Java 端口。
 */
export async function getModelSettings(requester: Requester = fetch): Promise<ModelSettings> {
  const response = await requester(MODEL_SETTINGS_ENDPOINT, { cache: "no-store" });
  return extractModelSettings(await readApiResponse(response));
}

/**
 * 测试未来后台接口是否能访问供应商；测试动作不写入本地配置文件。
 */
export async function testModelSettings(
  draft: ModelSettingsDraft,
  requester: Requester = fetch,
): Promise<ModelSettings> {
  const response = await requester(`${MODEL_SETTINGS_ENDPOINT}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildModelSettingsUpdate(draft)),
  });
  return extractModelSettings(await readApiResponse(response));
}

/**
 * 保存模型服务配置，并让页面用返回的模型摘要更新状态；是否真正热加载由未来后台接口负责。
 */
export async function updateModelSettings(
  draft: ModelSettingsDraft,
  requester: Requester = fetch,
): Promise<ModelSettings> {
  const response = await requester(MODEL_SETTINGS_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildModelSettingsUpdate(draft)),
  });
  return extractModelSettings(await readApiResponse(response));
}

async function readApiResponse(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const source = isRecord(payload) ? payload : {};
    const message = [source.message, source.msg, source.error].find(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    throw new Error(message ?? `模型设置接口请求失败（${response.status}）`);
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
