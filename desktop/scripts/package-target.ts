import { spawn } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assembleResourceBundle, createResourceAssemblyPlan } from "../src/build/resource-assembly.js";
import { createGradleBootJarCommand } from "../src/build/gradle-command.js";
import { createElectronBuilderArguments } from "../src/build/package-target.js";
import { createRuntimePreparationPlan, readRuntimeManifest } from "../src/build/runtime-manifest.js";
import { prepareRuntimeCache } from "../src/build/runtime-preparation.js";
import { assertExecutableVersion, getRuntimeExecutableRelativePath, verifyExecutableArchitecture } from "../src/build/resource-verification.js";
import { desktopTargets, isCurrentHostTarget, type DesktopTargetKey } from "../src/shared/platform.js";

const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectory = path.resolve(desktopDirectory, "..");
const targetKey = readTargetKey();

assertNativeBuildHost(targetKey);
await buildApplicationArtifacts();
const manifest = await readRuntimeManifest(path.join(desktopDirectory, "resources", "runtime", "manifest.json"));
const runtimePlan = createRuntimePreparationPlan({ desktopDirectory, targetKey, manifest });
await prepareRuntimeCache({ plan: runtimePlan });
await verifyRuntimeCache(runtimePlan);
const assemblyPlan = createResourceAssemblyPlan({ desktopDirectory, workspaceDirectory, targetKey });
await assembleResourceBundle(assemblyPlan);
await runCommand(
  process.execPath,
  [path.join(desktopDirectory, "node_modules", "electron-builder", "out", "cli", "cli.js"), ...createElectronBuilderArguments(targetKey)],
  desktopDirectory,
  { ...process.env, MBOO_TARGET_KEY: targetKey },
);

function readTargetKey(): DesktopTargetKey {
  const targetKey = process.argv[2];
  if (targetKey === "win32-x64" || targetKey === "darwin-x64" || targetKey === "darwin-arm64") return targetKey;
  throw new Error("请传入目标平台：win32-x64、darwin-x64 或 darwin-arm64");
}

/**
 * 先构建 Electron、Java JAR 和 Next.js standalone，确保资源组装不会误打包旧产物。
 */
async function buildApplicationArtifacts(): Promise<void> {
  const javaHome = process.env.MBOO_JAVA_HOME ?? process.env.JAVA_HOME;
  const gradleCommand = createGradleBootJarCommand(process.platform, javaHome);
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) throw new Error("无法获取 npm CLI 路径");
  await access(npmCliPath);
  await runCommand(process.execPath, [npmCliPath, "run", "build"], desktopDirectory, process.env);
  await runCommand(gradleCommand.command, gradleCommand.arguments, workspaceDirectory, gradleCommand.environment);
  await runCommand(process.execPath, [npmCliPath, "run", "build"], path.join(workspaceDirectory, "mboo-web"), process.env);
  await verifyStandaloneNativeModules(path.join(workspaceDirectory, "mboo-web", ".next", "standalone"));
}

async function verifyRuntimeCache(runtimePlan: ReturnType<typeof createRuntimePreparationPlan>): Promise<void> {
  const componentByKind = Object.fromEntries(runtimePlan.components.map((component) => [component.kind, component.outputPath])) as Record<"jre" | "node" | "rg", string>;
  const javaExecutable = path.join(componentByKind.jre, getRuntimeExecutableRelativePath("jre", runtimePlan.targetKey));
  const nodeExecutable = path.join(componentByKind.node, getRuntimeExecutableRelativePath("node", runtimePlan.targetKey));
  const rgExecutable = path.join(path.dirname(componentByKind.rg), getRuntimeExecutableRelativePath("rg", runtimePlan.targetKey));
  await verifyExecutableArchitecture(javaExecutable, runtimePlan.targetKey, "JRE");
  await verifyExecutableArchitecture(nodeExecutable, runtimePlan.targetKey, "Node.js");
  await verifyExecutableArchitecture(rgExecutable, runtimePlan.targetKey, "rg");
  if (!isCurrentHostTarget(runtimePlan.targetKey)) return;

  const target = manifest.targets[runtimePlan.targetKey];
  assertExecutableVersion(await readCommandOutput(javaExecutable, ["-version"]), target.jre.version, "JRE");
  assertExecutableVersion(await readCommandOutput(nodeExecutable, ["--version"]), target.node.version, "Node.js");
  assertExecutableVersion(await readCommandOutput(rgExecutable, ["--version"]), target.rg.version, "rg");
}

function assertNativeBuildHost(target: DesktopTargetKey): void {
  if (isCurrentHostTarget(target)) return;
  const expected = desktopTargets[target];
  throw new Error(`完整桌面封包必须在目标原生构建机执行：目标 ${expected.platform}/${expected.architecture}，当前 ${process.platform}/${process.arch}`);
}

async function verifyStandaloneNativeModules(directory: string): Promise<void> {
  for (const file of await findFilesBySuffix(directory, ".node")) {
    await verifyExecutableArchitecture(file, targetKey, `Next.js 原生模块 ${path.basename(file)}`);
  }
}

async function findFilesBySuffix(directory: string, suffix: string): Promise<string[]> {
  const matches: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...await findFilesBySuffix(entryPath, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) matches.push(entryPath);
  }
  return matches;
}

function readCommandOutput(command: string, argumentsList: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { stdio: "pipe" });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(`${output}\n${errorOutput}`.trim());
      else reject(new Error(`无法执行 ${command}：${errorOutput.trim()}`));
    });
  });
}

function runCommand(command: string, argumentsList: string[], cwd: string, environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, { cwd, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`构建命令执行失败：${command} ${argumentsList.join(" ")}（退出码 ${code ?? "unknown"}）`));
    });
  });
}
