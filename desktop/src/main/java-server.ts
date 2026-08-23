import path from "node:path";

import type { DesktopArchitecture, DesktopPlatform } from "../shared/platform.js";
import { getDesktopResourceLayout } from "../shared/resource-layout.js";
import { buildSqliteJdbcUrl } from "./sqlite-url.js";

export interface JavaServerLaunchSpec {
  executable: string;
  arguments: string[];
  environment: Record<string, string>;
}

export interface JavaServerLaunchOptions {
  resourcesDirectory: string;
  appDataDirectory: string;
  platform: DesktopPlatform;
  architecture: DesktopArchitecture;
  port: number;
  instanceId: string;
}

/**
 * 统一生成 Java sidecar 的启动契约，使 SQLite、JSONL、工具结果与随包 rg 都由 Electron 的同一数据和资源边界控制。
 */
export function createJavaServerLaunchSpec(options: JavaServerLaunchOptions): JavaServerLaunchSpec {
  const layout = getDesktopResourceLayout(options.resourcesDirectory, options.platform, options.architecture);
  const pathApi = options.platform === "win32" ? path.win32 : path.posix;
  const nodeDirectory = pathApi.dirname(layout.nodeExecutable);
  const rgDirectory = pathApi.dirname(layout.rgExecutable);
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const inheritedPath = process.env[pathKey] ?? "";
  const pathDelimiter = options.platform === "win32" ? ";" : ":";
  const pathDirectories = inheritedPath.length > 0 ? inheritedPath.split(pathDelimiter) : [];
  const normalizedDirectories = new Set(pathDirectories.map((directory) => options.platform === "win32" ? directory.toLowerCase() : directory));
  for (const directory of [nodeDirectory, rgDirectory]) {
    const normalized = options.platform === "win32" ? directory.toLowerCase() : directory;
    if (normalizedDirectories.has(normalized)) continue;
    pathDirectories.push(directory);
    normalizedDirectories.add(normalized);
  }

  return {
    executable: layout.javaExecutable,
    arguments: [
      `-Dserver.port=${options.port}`,
      "-Dserver.address=127.0.0.1",
      `-Dmboo.appDataDir=${options.appDataDirectory}`,
      `-Dspring.datasource.url=${buildSqliteJdbcUrl(options.appDataDirectory, options.platform)}`,
      `-Dmboo.rgPath=${layout.rgExecutable}`,
      "-jar",
      layout.backendJar,
    ],
    environment: {
      MBOO_INSTANCE_ID: options.instanceId,
      [pathKey]: pathDirectories.join(pathDelimiter),
    },
  };
}
