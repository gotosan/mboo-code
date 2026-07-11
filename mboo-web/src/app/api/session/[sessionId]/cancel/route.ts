import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    signal: request.signal,
  });
}
