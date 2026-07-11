import { getApiBaseUrl, parseUpstreamErrorMessage } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "请求体不是有效 JSON" }, { status: 400 });
  }

  const apiBaseUrl = getApiBaseUrl();

  try {
    const upstream = await fetch(`${apiBaseUrl}/session/chat`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: request.signal,
    });

    const contentType = upstream.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("text/event-stream")) {
      const errorText = await upstream.text().catch(() => "");
      return Response.json(
        { message: parseUpstreamErrorMessage(errorText) },
        { status: upstream.ok ? 502 : upstream.status },
      );
    }

    if (!upstream.body) {
      return Response.json(
        { message: "后端没有返回可读取的会话事件流" },
        { status: upstream.ok ? 502 : upstream.status },
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", contentType || "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return Response.json(
      { message: `无法连接后端会话服务：${message}` },
      { status: 502 },
    );
  }
}
