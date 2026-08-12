import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    sessionId: string;
    approvalId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId, approvalId } = await context.params;
  const body = await request.text();
  return proxyBackendJson(`/session/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    },
    body,
  });
}
