import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/unarchive`, {
    method: "POST",
  });
}