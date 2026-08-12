import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
    resultId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId, resultId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/tool-results/${encodeURIComponent(resultId)}`);
}
