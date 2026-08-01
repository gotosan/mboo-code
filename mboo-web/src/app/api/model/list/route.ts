import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyBackendJson("/config/modelList");
}
