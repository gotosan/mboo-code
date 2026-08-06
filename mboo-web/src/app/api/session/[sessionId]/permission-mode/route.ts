import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = await request.text();
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/permission-mode`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
}