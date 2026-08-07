import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    modelId: string;
  }>;
};

function backendPath(modelId: string) {
  return `/config/modelContextLimit?modelId=${encodeURIComponent(modelId)}`;
}

export async function GET(_request: Request, context: RouteContext) {
  const { modelId } = await context.params;
  return proxyBackendJson(backendPath(modelId));
}

export async function PUT(request: Request, context: RouteContext) {
  const { modelId } = await context.params;
  return proxyBackendJson(backendPath(modelId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { modelId } = await context.params;
  return proxyBackendJson(backendPath(modelId), { method: "DELETE" });
}
