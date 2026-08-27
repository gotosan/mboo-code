import path from "node:path";

export type WorkspacePickerPlatform = "win32" | "darwin" | "linux";

/**
 * 规范化系统选择器已确认的目录，保持宿主系统路径语义并避免页面收到相对路径或冗余片段。
 */
export function normalizeSelectedWorkspaceDirectory(directory: string, platform: WorkspacePickerPlatform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(directory)) {
    throw new Error("工作区目录必须是绝对路径");
  }
  return pathApi.normalize(pathApi.resolve(directory));
}
