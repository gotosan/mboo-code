import { proxyBackendResponse } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
    resultId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId, resultId } = await context.params;
  const source = new URL(request.url).searchParams.get("source") || "result";
  return proxyBackendResponse(
    `/session/${encodeURIComponent(sessionId)}/tool-results/${encodeURIComponent(resultId)}/content?source=${encodeURIComponent(source)}`,
  );
}
