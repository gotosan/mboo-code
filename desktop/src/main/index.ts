import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ShutdownCoordinator } from "./shutdown-coordinator.js";
import { createDiagnosticsDataUrl, createStartupDataUrl, createWindowSecurityOptions, isAllowedNavigation } from "./window-security.js";
import { isRevealTarget, type DesktopDiagnostics, type DesktopRuntimeState } from "../shared/contracts.js";
import { DesktopServiceStartError, startDesktopServices } from "./desktop-service-manager.js";
import { normalizeSelectedWorkspaceDirectory } from "./workspace-picker.js";
import { resolveRevealDirectory, resolveToolResultFile } from "./reveal-path.js";
import { resolveDesktopAppDataDirectory } from "./app-data-directory.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.join(currentDirectory, "../preload/index.cjs");
const shutdownCoordinator = new ShutdownCoordinator();
let mainWindow: BrowserWindow | undefined;
let allowedNavigationUrl: string | undefined;
let isQuitting = false;
let currentDesktopUrl: string | undefined;
let confirmedWorkspaceDirectory: string | undefined;
const runtimeState: DesktopRuntimeState = { mode: "initializing", version: app.getVersion() };
const diagnostics: DesktopDiagnostics = { phase: "initializing", message: "桌面服务正在初始化" };

function registerBridgeHandlers(): void {
  ipcMain.handle("mboo:workspace:select-directory", async () => {
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    const pickerPlatform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
    confirmedWorkspaceDirectory = normalizeSelectedWorkspaceDirectory(result.filePaths[0], pickerPlatform);
    return confirmedWorkspaceDirectory;
  });
  ipcMain.handle("mboo:path:reveal", async (_event, target: unknown) => {
    if (!isRevealTarget(target)) return false;
    const targetPath = resolveRevealDirectory(target, getDesktopAppDataDirectory(), confirmedWorkspaceDirectory);
    return targetPath ? (await shell.openPath(targetPath)) === "" : false;
  });
  ipcMain.handle("mboo:tool-result:reveal", async (_event, sessionId: unknown, resultId: unknown) => {
    if (typeof sessionId !== "string" || typeof resultId !== "string") return false;
    const resultPath = await resolveToolResultFile(getDesktopAppDataDirectory(), sessionId, resultId);
    if (!resultPath) return false;
    shell.showItemInFolder(resultPath);
    return true;
  });
  ipcMain.handle("mboo:app:version", () => app.getVersion());
  ipcMain.handle("mboo:app:restart", () => {
    if (isQuitting) return false;
    app.relaunch();
    app.quit();
    return true;
  });
  ipcMain.handle("mboo:runtime:get", () => runtimeState);
  ipcMain.handle("mboo:diagnostics:get", () => diagnostics);
}

function getDesktopAppDataDirectory(): string {
  return resolveDesktopAppDataDirectory(app.getPath("home"), process.env.MBOO_DESKTOP_APP_DATA_DIR);
}

/**
 * 只由主进程创建窗口并集中处理导航策略，避免渲染进程取得系统权限或离开本地应用页面后继续使用桥接能力。
 */
function createMainWindow(localUrl?: string): BrowserWindow {
  const window = new BrowserWindow(createWindowSecurityOptions(preloadPath));
  const initialUrl = localUrl ?? createDiagnosticsDataUrl(diagnostics);
  allowedNavigationUrl = initialUrl;

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (allowedNavigationUrl && (allowedNavigationUrl.startsWith("data:") ? targetUrl === allowedNavigationUrl : isAllowedNavigation(targetUrl, allowedNavigationUrl))) return;
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = undefined;
      allowedNavigationUrl = undefined;
    }
  });

  if (localUrl) {
    void window.loadURL(localUrl);
  } else {
    void window.loadURL(initialUrl);
    window.show();
  }
  return window;
}

function navigateMainWindow(targetUrl: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  allowedNavigationUrl = targetUrl;
  void mainWindow.loadURL(targetUrl);
}

/**
 * 开发模式保留显式前端地址；生产模式先显示轻量启动页，两个 sidecar 健康后复用同一窗口切换到 Next.js。
 */
async function initializeDesktop(): Promise<void> {
  if (currentDesktopUrl) {
    mainWindow = createMainWindow(currentDesktopUrl);
    return;
  }
  const developmentUrl = process.env.MBOO_DESKTOP_URL;
  if (developmentUrl) {
    currentDesktopUrl = developmentUrl;
    runtimeState.mode = "ready";
    diagnostics.phase = "development";
    diagnostics.message = "已连接开发前端服务";
    mainWindow = createMainWindow(currentDesktopUrl);
    return;
  }

  const shouldShowWindow = !process.argv.includes("--smoke-parent-crash") && !process.argv.includes("--smoke-exit-after-ready");
  if (shouldShowWindow && !mainWindow) mainWindow = createMainWindow(createStartupDataUrl());

  try {
    await startProductionServices();
    if (isQuitting) return;
    if (process.argv.includes("--smoke-exit-after-ready")) {
      setTimeout(() => app.quit(), 500);
      return;
    }
    if (shouldShowWindow && currentDesktopUrl) navigateMainWindow(currentDesktopUrl);
  } catch (error) {
    if (isQuitting) return;
    runtimeState.mode = "failed";
    if (error instanceof DesktopServiceStartError) {
      Object.assign(diagnostics, error.diagnostics);
    } else {
      diagnostics.phase = "startup-failed";
      diagnostics.message = error instanceof Error ? error.message : "桌面服务启动失败";
    }
    if (shouldShowWindow) {
      if (mainWindow) navigateMainWindow(createDiagnosticsDataUrl(diagnostics));
      else mainWindow = createMainWindow();
    }
  }
}

async function startProductionServices(): Promise<void> {
  const result = await startDesktopServices({
    resourcesDirectory: process.resourcesPath,
    userDataDirectory: app.getPath("userData"),
    appDataDirectory: getDesktopAppDataDirectory(),
    platform: process.platform,
    architecture: process.arch,
  });
  const { runtime: services, diagnostics: serviceDiagnostics } = result;
  if (isQuitting) {
    await Promise.allSettled([services.javaProcess.stop(), services.nextProcess.stop()]);
    throw new Error("桌面端正在退出，取消服务启动");
  }
  shutdownCoordinator.register(() => services.javaProcess.stop());
  shutdownCoordinator.register(() => services.nextProcess.stop());
  runtimeState.mode = "ready";
  Object.assign(diagnostics, serviceDiagnostics);
  currentDesktopUrl = `http://${services.ports.host}:${services.ports.nextPort}`;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerBridgeHandlers();
    void initializeDesktop();
    app.on("activate", () => {
      if (!mainWindow && runtimeState.mode === "ready") void initializeDesktop();
    });
  });

  app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    void shutdownCoordinator.shutdown().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
