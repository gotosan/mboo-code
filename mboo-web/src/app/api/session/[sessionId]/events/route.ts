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
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/events${query}`);
}
