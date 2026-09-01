import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string; turnId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId, turnId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`, { method: "POST" });
}
