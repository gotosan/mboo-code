import { open } from "node:fs/promises";

import type { DesktopTargetKey } from "../shared/platform.js";

export type RuntimeComponentKind = "jre" | "node" | "rg";
type BinaryArchitecture = "x64" | "arm64";

const PE_AMD64 = 0x8664;
const MACH_CPU_X64 = 0x01000007;
const MACH_CPU_ARM64 = 0x0100000c;
const MACH_MAGIC_64 = 0xfeedfacf;
const MACH_FAT_MAGIC = 0xcafebabe;
const MACH_FAT_MAGIC_64 = 0xcafebabf;

/**
 * 统一三类运行时在 Windows 与 POSIX 资源目录中的可执行文件相对路径。
 */
export function getRuntimeExecutableRelativePath(kind: RuntimeComponentKind, targetKey: DesktopTargetKey): string {
  const isWindows = targetKey === "win32-x64";
  if (kind === "jre") return isWindows ? "bin/java.exe" : "bin/java";
  if (kind === "node") return isWindows ? "node.exe" : "bin/node";
  return isWindows ? "rg.exe" : "rg";
}

/**
 * 以清单冻结版本校验可执行文件输出，确保下载镜像或缓存替换不会悄悄降低运行时版本。
 */
export function assertExecutableVersion(output: string, expectedVersion: string, componentName: string): void {
  const comparableVersion = expectedVersion.replace(/\+.*/, "");
  if (!output.includes(comparableVersion)) throw new Error(`${componentName} 版本不匹配：期望包含 ${comparableVersion}，实际 ${output}`);
}

/**
 * 直接读取 PE 或 Mach-O 头校验目标架构，避免 Windows 构建依赖默认不存在的 file 命令。
 */
export async function verifyExecutableArchitecture(executablePath: string, targetKey: DesktopTargetKey, componentName: string): Promise<void> {
  const architectures = await readBinaryArchitectures(executablePath);
  const expected: BinaryArchitecture = targetKey.endsWith("arm64") ? "arm64" : "x64";
  if (!architectures.includes(expected)) {
    throw new Error(`${componentName} CPU 架构不匹配：目标 ${targetKey}，实际 ${architectures.join(", ") || "无法识别"}，文件 ${executablePath}`);
  }
}

export async function readBinaryArchitectures(executablePath: string): Promise<BinaryArchitecture[]> {
  const file = await open(executablePath, "r");
  try {
    const metadata = await file.stat();
    const buffer = Buffer.alloc(Math.min(metadata.size, 65_536));
    await file.read(buffer, 0, buffer.length, 0);
    const pe = readPeArchitecture(buffer);
    if (pe) return [pe];
    const mach = readMachArchitectures(buffer);
    if (mach.length > 0) return mach;
    throw new Error(`无法识别二进制格式：${executablePath}`);
  } finally {
    await file.close();
  }
}

function readPeArchitecture(buffer: Buffer): BinaryArchitecture | undefined {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return undefined;
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 > buffer.length || buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0") return undefined;
  const machine = buffer.readUInt16LE(peOffset + 4);
  if (machine === PE_AMD64) return "x64";
  if (machine === 0xaa64) return "arm64";
  return undefined;
}

function readMachArchitectures(buffer: Buffer): BinaryArchitecture[] {
  if (buffer.length < 8) return [];
  if (buffer.readUInt32LE(0) === MACH_MAGIC_64) return architectureFromMachCpu(buffer.readUInt32LE(4));
  if (buffer.readUInt32BE(0) === MACH_MAGIC_64) return architectureFromMachCpu(buffer.readUInt32BE(4));

  const bigEndianMagic = buffer.readUInt32BE(0);
  const littleEndianMagic = buffer.readUInt32LE(0);
  if (![MACH_FAT_MAGIC, MACH_FAT_MAGIC_64].includes(bigEndianMagic) && ![MACH_FAT_MAGIC, MACH_FAT_MAGIC_64].includes(littleEndianMagic)) return [];
  const isBigEndian = [MACH_FAT_MAGIC, MACH_FAT_MAGIC_64].includes(bigEndianMagic);
  const is64 = (isBigEndian ? bigEndianMagic : littleEndianMagic) === MACH_FAT_MAGIC_64;
  const readUInt32 = (offset: number) => isBigEndian ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset);
  const count = readUInt32(4);
  const entrySize = is64 ? 32 : 20;
  const architectures = new Set<BinaryArchitecture>();
  for (let index = 0; index < count && 8 + (index + 1) * entrySize <= buffer.length; index++) {
    architectureFromMachCpu(readUInt32(8 + index * entrySize)).forEach((architecture) => architectures.add(architecture));
  }
  return [...architectures];
}

function architectureFromMachCpu(cpuType: number): BinaryArchitecture[] {
  if (cpuType === MACH_CPU_X64) return ["x64"];
  if (cpuType === MACH_CPU_ARM64) return ["arm64"];
  return [];
}
