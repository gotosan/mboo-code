export type DesktopPlatform = "win32" | "darwin";
export type DesktopArchitecture = "x64" | "arm64";
export type DesktopTargetKey = "win32-x64" | "darwin-x64" | "darwin-arm64";

export interface DesktopPlatformInfo {
  key: DesktopTargetKey;
  platform: DesktopPlatform;
  architecture: DesktopArchitecture;
  rgFileName: "rg.exe" | "rg";
}

export const desktopTargets: Record<DesktopTargetKey, DesktopPlatformInfo> = {
  "win32-x64": { key: "win32-x64", platform: "win32", architecture: "x64", rgFileName: "rg.exe" },
  "darwin-x64": { key: "darwin-x64", platform: "darwin", architecture: "x64", rgFileName: "rg" },
  "darwin-arm64": { key: "darwin-arm64", platform: "darwin", architecture: "arm64", rgFileName: "rg" },
};

/**
 * 将 Electron 运行时标识收敛为发布清单中的固定目标键，避免不同模块各自判断平台而选到错误资源。
 */
export function resolveDesktopPlatform(platform: string, architecture: string): DesktopPlatformInfo {
  const target = Object.values(desktopTargets).find((item) => item.platform === platform && item.architecture === architecture);
  if (target) return target;
  throw new Error(`不支持的平台或 CPU 架构: ${platform}/${architecture}`);
}

export function isCurrentHostTarget(targetKey: DesktopTargetKey): boolean {
  const target = desktopTargets[targetKey];
  return process.platform === target.platform && process.arch === target.architecture;
}
