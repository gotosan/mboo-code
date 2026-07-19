import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST() {
  return proxyBackendJson("/workspace/select-directory", {
    method: "POST",
  });
}
