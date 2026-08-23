import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

/**
 * 预留模型设置的同源代理边界；后台接口上线后只需保持 `/config/modelSettings` 契约，页面无需跨端口改造。
 */
export async function GET() {
  return proxyBackendJson("/config/modelSettings");
}

export async function POST(request: Request) {
  return proxyBackendJson("/config/modelSettings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}

export async function PUT(request: Request) {
  return proxyBackendJson("/config/modelSettings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
}
