import { proxyBackendJson } from "@/lib/backend-api";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  const turnId = new URL(request.url).searchParams.get("turnId");
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/subagents${turnId ? `?turnId=${encodeURIComponent(turnId)}` : ""}`);
}
