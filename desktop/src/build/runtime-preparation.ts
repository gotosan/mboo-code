import { chmod, cp, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import extractZip from "@electron-internal/extract-zip";
import { extract as extractTar } from "tar";

import type { RuntimePreparationComponent, RuntimePreparationPlan } from "./runtime-manifest.js";
import { verifyRuntimeArchive } from "./runtime-manifest.js";
import { getRuntimeExecutableRelativePath } from "./resource-verification.js";

export interface PrepareRuntimeCacheOptions {
  plan: RuntimePreparationPlan;
  downloadArchive?: (component: RuntimePreparationComponent) => Promise<void>;
  extractArchive?: (component: RuntimePreparationComponent, extractionDirectory: string) => Promise<string>;
}

/**
 * 下载、校验并解压一个目标的运行时资源，再以原子目录切换发布缓存，避免跨平台资源或半成品进入打包输入。
 */
export async function prepareRuntimeCache(options: PrepareRuntimeCacheOptions): Promise<void> {
  const downloadArchive = options.downloadArchive ?? downloadRuntimeArchive;
  const extractArchive = options.extractArchive ?? extractRuntimeArchive;
  const cacheParentDirectory = path.dirname(options.plan.cacheDirectory);
  await mkdir(options.plan.archivesDirectory, { recursive: true });
  await mkdir(cacheParentDirectory, { recursive: true });
  const temporaryCacheDirectory = await mkdtemp(path.join(cacheParentDirectory, `.${options.plan.targetKey}-`));

  try {
    for (const component of options.plan.components) {
      await downloadArchive(component);
      await verifyRuntimeArchive(component.archivePath, component.component.sha256);

      const extractionDirectory = path.join(temporaryCacheDirectory, ".extracted", component.kind);
      await mkdir(extractionDirectory, { recursive: true });
      const extractedDirectory = await extractArchive(component, extractionDirectory);
      const source = await locateExtractedResource(component, extractedDirectory, options.plan.targetKey === "win32-x64");
      const destination = path.join(temporaryCacheDirectory, path.relative(options.plan.cacheDirectory, component.outputPath));

      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: component.kind !== "rg", force: true, preserveTimestamps: true });
      await copyComponentLicenses(component.kind, source, path.join(temporaryCacheDirectory, "licenses", component.kind));
      if (component.kind === "rg" && options.plan.targetKey !== "win32-x64") {
        await chmod(destination, 0o755);
      }
    }

    await removeDirectory(path.join(temporaryCacheDirectory, ".extracted"));
    await removeDirectory(options.plan.cacheDirectory);
    await renameWithRetry(temporaryCacheDirectory, options.plan.cacheDirectory);
  } catch (error) {
    await removeDirectory(temporaryCacheDirectory);
    throw error;
  }
}

/**
 * 缓存命中也重新验证 SHA-256；供应链清单变化或缓存被篡改时不能继续使用旧归档。
 */
export async function downloadRuntimeArchive(component: RuntimePreparationComponent): Promise<void> {
  try {
    await verifyRuntimeArchive(component.archivePath, component.component.sha256);
    return;
  } catch {
    // 校验失败时下载新的临时归档，旧缓存不会作为可信输入继续使用。
  }

  const response = await fetch(component.component.url);
  if (!response.ok || !response.body) {
    throw new Error(`下载桌面运行时失败：${component.component.url}（HTTP ${response.status}）`);
  }

  await mkdir(path.dirname(component.archivePath), { recursive: true });
  const temporaryArchivePath = `${component.archivePath}.download`;
  await rm(temporaryArchivePath, { force: true });
  try {
    await writeWebStreamToFile(response.body, temporaryArchivePath);
    await verifyRuntimeArchive(temporaryArchivePath, component.component.sha256);
    await renameWithRetry(temporaryArchivePath, component.archivePath);
  } catch (error) {
    await rm(temporaryArchivePath, { force: true });
    throw error;
  }
}

async function writeWebStreamToFile(body: ReadableStream<Uint8Array>, outputPath: string): Promise<void> {
  const reader = body.getReader();
  const output = createWriteStream(outputPath);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(value)) await once(output, "drain");
    }
    output.end();
    await once(output, "finish");
  } catch (error) {
    output.destroy(error instanceof Error ? error : undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * 使用 Node 库解压 ZIP 与 tar.gz，避免 Windows 构建机依赖 file、tar 或 Git Bash 等额外命令。
 */
export async function extractRuntimeArchive(component: RuntimePreparationComponent, extractionDirectory: string): Promise<string> {
  if (component.archivePath.endsWith(".zip")) {
    await extractZip(component.archivePath, { dir: extractionDirectory });
    return extractionDirectory;
  }
  if (!component.archivePath.endsWith(".tar.gz") && !component.archivePath.endsWith(".tgz")) {
    throw new Error(`不支持的运行时归档格式：${component.component.name}`);
  }
  await extractTar({
    file: component.archivePath,
    cwd: extractionDirectory,
    preservePaths: false,
    filter: (entryPath) => {
      assertSafeArchivePath(entryPath);
      return true;
    },
  });
  return extractionDirectory;
}

function assertSafeArchivePath(entryPath: string): void {
  const normalized = entryPath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`运行时归档包含不安全路径：${entryPath}`);
  }
}

async function locateExtractedResource(
  component: RuntimePreparationComponent,
  extractedDirectory: string,
  isWindows: boolean,
): Promise<string> {
  const executable = path.basename(getRuntimeExecutableRelativePath(component.kind, isWindows ? "win32-x64" : "darwin-arm64"));
  const match = await findMatchingResource(extractedDirectory, component.kind, executable, isWindows);
  if (!match) {
    throw new Error(`运行时归档缺少 ${component.kind} 可执行文件：${component.component.name}`);
  }
  return match;
}

async function findMatchingResource(
  directory: string,
  kind: RuntimePreparationComponent["kind"],
  executable: string,
  isWindows: boolean,
): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) {
      if (isWindows && kind === "node" && entry.name === executable) return directory;
      if (kind === "rg" && entry.name === executable) return entryPath;
      continue;
    }
    if (kind === "rg" && entry.name === "rg") {
      const executablePath = path.join(entryPath, executable);
      if (await isFile(executablePath)) return executablePath;
    }
    if (kind !== "rg") {
      const executablePath = path.join(entryPath, "bin", executable);
      if (await isFile(executablePath)) return entryPath;
    }
    const nestedMatch = await findMatchingResource(entryPath, kind, executable, isWindows);
    if (nestedMatch) return nestedMatch;
  }

  if (kind === "rg") {
    const executablePath = path.join(directory, executable);
    if (await isFile(executablePath)) return executablePath;
  }
  return undefined;
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function copyComponentLicenses(kind: RuntimePreparationComponent["kind"], source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  if (kind === "jre") {
    await copyIfExists(path.join(source, "legal"), path.join(destination, "legal"), true);
    for (const name of ["NOTICE", "LICENSE", "ASSEMBLY_EXCEPTION", "ADDITIONAL_LICENSE_INFO"]) {
      await copyIfExists(path.join(source, name), path.join(destination, name), false);
    }
    if (!await containsFile(destination)) throw new Error("Temurin 运行时归档缺少许可证文件");
    return;
  }
  const root = kind === "rg" ? path.dirname(source) : source;
  for (const name of kind === "node" ? ["LICENSE"] : ["LICENSE-MIT", "UNLICENSE", "COPYING"]) {
    await copyIfExists(path.join(root, name), path.join(destination, name), false);
  }
  if (!await containsFile(destination)) throw new Error(`${kind === "node" ? "Node.js" : "ripgrep"} 运行时归档缺少许可证文件`);
}

async function copyIfExists(source: string, destination: string, recursive: boolean): Promise<void> {
  try {
    await cp(source, destination, { recursive, force: true, preserveTimestamps: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function containsFile(directory: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && await containsFile(path.join(directory, entry.name))) return true;
  }
  return false;
}

async function removeDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 1, retryDelay: 200 });
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (attempt === 5 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
}
