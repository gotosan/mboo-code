import { getApiBaseUrl, parseUpstreamErrorMessage } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  if (!sessionId) {
    return Response.json({ message: "会话 ID 不能为空" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return Response.json({ message: "请求体不是有效 JSON" }, { status: 400 });
  }

  const apiBaseUrl = getApiBaseUrl();

  try {
    const upstream = await fetch(
      `${apiBaseUrl}/session/${encodeURIComponent(sessionId)}/context/compress`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: request.signal,
      },
    );

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
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
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
