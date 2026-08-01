import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST() {
  return proxyBackendJson("/config/selectDirectory", {
    method: "POST",
  });
}
