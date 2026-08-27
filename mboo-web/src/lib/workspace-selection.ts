export interface DesktopWorkspaceBridge {
  selectWorkspaceDirectory(): Promise<string | undefined>;
}

/**
 * 桌面环境优先使用受控 Preload 桥接；桥接初始化失败或 IPC 调用失败时回退 Java 接口。
 * 桥接正常返回 undefined 表示用户取消，此时不再重复打开 Java 选择器。
 */
export async function selectWorkspacePath(
  desktopBridge: DesktopWorkspaceBridge | undefined,
  selectInBrowser: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!desktopBridge) {
    return selectInBrowser();
  }
  try {
    return await desktopBridge.selectWorkspaceDirectory();
  } catch {
    return selectInBrowser();
  }
}
