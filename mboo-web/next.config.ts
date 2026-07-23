import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactCompiler: true,
  // 避免上层多 lockfile 导致 workspace root 误判与多余扫描
  turbopack: {
    root: rootDir,
  },
};

export default nextConfig;
