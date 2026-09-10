import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const parent = new URL(request.url).searchParams.get("parentSessionId");
  const query = parent ? `?parentSessionId=${encodeURIComponent(parent)}` : "";
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}${query}`);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = await request.text();
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    },
    body,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
