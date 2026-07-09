const DEFAULT_API_BASE_URL = "http://localhost:8080";

export function getApiBaseUrl() {
  return (process.env.MBOO_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

export async function proxyBackendJson(path: string, init: RequestInit = {}) {
  const apiBaseUrl = getApiBaseUrl();
  const upstream = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    cache: "no-store",
  });

  const contentType = upstream.headers.get("Content-Type") || "";
  const text = await upstream.text().catch(() => "");

  if (!contentType.toLowerCase().includes("application/json")) {
    return Response.json(
      { message: parseUpstreamErrorMessage(text) },
      { status: upstream.ok ? 502 : upstream.status },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType || "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");

  return new Response(text, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export function parseUpstreamErrorMessage(text: string) {
  if (!text.trim()) {
    return "后端没有返回有效响应";
  }

  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const message = data.message || data.msg || data.error || data.exception;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  } catch {
    return text.trim();
  }

  return text.trim();
}
