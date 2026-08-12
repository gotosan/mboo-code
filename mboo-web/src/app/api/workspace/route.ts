import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  return proxyBackendJson("/workspace", {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
    },
    body,
  });
}
