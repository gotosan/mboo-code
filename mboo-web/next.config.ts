import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// 设计决策：MarkStream 可选图示 peer 写成静态 import()，Turbopack 会硬解析；
// 第一期映射到本地空模块，避免安装未使用的大依赖。
const optionalPeerAliases = {
  "@antv/infographic": "./src/lib/markstream-stubs/empty-module.ts",
  "@terrastruct/d2": "./src/lib/markstream-stubs/empty-module.ts",
  mermaid: "./src/lib/markstream-stubs/empty-module.ts",
  katex: "./src/lib/markstream-stubs/empty-module.ts",
  "stream-monaco": "./src/lib/markstream-stubs/empty-module.ts",
  "stream-markdown": "./src/lib/markstream-stubs/empty-module.ts",
};

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 避免上层多 lockfile 导致 workspace root 误判与多余扫描
  turbopack: {
    root: rootDir,
    resolveAlias: optionalPeerAliases,
  },
  webpack: (config) => {
    const emptyModule = path.join(rootDir, "src/lib/markstream-stubs/empty-module.ts");
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@antv/infographic": emptyModule,
      "@terrastruct/d2": emptyModule,
      mermaid: emptyModule,
      katex: emptyModule,
      "stream-monaco": emptyModule,
      "stream-markdown": emptyModule,
    };
    return config;
  },
};

export default nextConfig;
