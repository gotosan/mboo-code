import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string; askId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { sessionId, askId } = await context.params;
  const body = await request.text();
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/asks/${encodeURIComponent(askId)}/answers`, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") || "application/json" },
    body,
  });
}
