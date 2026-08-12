import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { workspaceId } = await context.params;
  return proxyBackendJson(`/workspace/${encodeURIComponent(workspaceId)}`, {
    method: "DELETE",
  });
}
