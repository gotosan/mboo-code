import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    modelId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { modelId } = await context.params;
  return proxyBackendJson(`/config/modelInfo?modelId=${encodeURIComponent(modelId)}`);
}
