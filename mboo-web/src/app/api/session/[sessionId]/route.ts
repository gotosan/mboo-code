import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}`);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const body = await request.text();
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    },
    body,
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}
