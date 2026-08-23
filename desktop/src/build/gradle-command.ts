export interface GradleBuildCommand {
  command: string;
  arguments: string[];
  environment: NodeJS.ProcessEnv;
}

/**
 * 通过 POSIX shell 调用仓库内 Gradle Wrapper，兼容 Git 未保留可执行位的工作树。
 */
export function createGradleBootJarCommand(platform: NodeJS.Platform, javaHome?: string): GradleBuildCommand {
  const environment = { ...process.env, ...(javaHome ? { JAVA_HOME: javaHome } : {}) };
  if (platform === "win32") return { command: process.env.ComSpec ?? "cmd.exe", arguments: ["/d", "/s", "/c", "gradlew.bat", "bootJar"], environment };
  return { command: "sh", arguments: ["./gradlew", "bootJar"], environment };
}
