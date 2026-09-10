import { proxyBackendJson } from "@/lib/backend-api";
export async function POST(_request: Request, context: { params: Promise<{ sessionId: string; runId: string }> }) {
  const { sessionId, runId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/subagent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}
