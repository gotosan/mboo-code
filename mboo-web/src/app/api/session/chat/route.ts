const DEFAULT_API_BASE_URL = "http://localhost:8080";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "请求体不是有效 JSON" }, { status: 400 });
  }

  const apiBaseUrl = (process.env.MBOO_API_BASE_URL || DEFAULT_API_BASE_URL).replace(
    /\/+$/,
    "",
  );

  try {
    const upstream = await fetch(`${apiBaseUrl}/session/chat`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
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

function parseUpstreamErrorMessage(text: string) {
  if (!text.trim()) {
    return "后端没有返回会话事件流";
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
