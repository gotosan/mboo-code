import { proxyBackendJson } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

/**
 * 模型设置的同源代理边界，浏览器不直接连接 Java 端口，也不会接触完整 API Key 的响应之外的内容。
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
