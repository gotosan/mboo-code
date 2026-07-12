import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const turnId = new URL(request.url).searchParams.get("turnId");
  const query = turnId ? `?turnId=${encodeURIComponent(turnId)}` : "";
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/cancel${query}`, {
    method: "POST",
    signal: request.signal,
  });
}
