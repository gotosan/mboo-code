import type { LoopbackPorts } from "./port-allocation.js";

export type StartupPhase = "java" | "next";

export interface DesktopStartupContext {
  attempt: number;
  instanceId: string;
  ports: LoopbackPorts;
  deadline: number;
}

export interface ManagedProcess {
  name: string;
  stop(): Promise<void>;
}

export interface DesktopServiceRuntime extends DesktopStartupContext {
  javaProcess: ManagedProcess;
  nextProcess: ManagedProcess;
}

export interface DesktopStartupDependencies {
  allocatePorts(): Promise<LoopbackPorts>;
  createInstanceId(): string;
  launchJava(context: DesktopStartupContext): Promise<ManagedProcess>;
  launchNext(context: DesktopStartupContext): Promise<ManagedProcess>;
  waitForHealth(options: { phase: StartupPhase; context: DesktopStartupContext; process: ManagedProcess }): Promise<void>;
  onPhase?(context: DesktopStartupContext, phase: string, message: string): void;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
}

export class StartupError extends Error {
}

/**
 * 并行托管 Java 与 Next 服务；失败时整轮回收并换用新端口，避免保留残留进程或误连旧实例。
 */
export class DesktopStartupCoordinator {
  private readonly maxAttempts: number;
  private readonly attemptTimeoutMs: number;

  constructor(private readonly dependencies: DesktopStartupDependencies) {
    this.maxAttempts = dependencies.maxAttempts ?? 3;
    this.attemptTimeoutMs = dependencies.attemptTimeoutMs ?? 30_000;
  }

  async start(): Promise<DesktopServiceRuntime> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const ports = await this.dependencies.allocatePorts();
      const context: DesktopStartupContext = {
        attempt,
        instanceId: this.dependencies.createInstanceId(),
        ports,
        deadline: Date.now() + this.attemptTimeoutMs,
      };
      let javaProcess: ManagedProcess | undefined;
      let nextProcess: ManagedProcess | undefined;

      try {
        this.reportPhase(context, "java-launch", "启动 Java sidecar");
        this.reportPhase(context, "next-launch", "启动 Next.js standalone 服务");
        const [javaLaunch, nextLaunch] = await Promise.allSettled([
          this.dependencies.launchJava(context),
          this.dependencies.launchNext(context),
        ]);
        if (javaLaunch.status === "fulfilled") javaProcess = javaLaunch.value;
        if (nextLaunch.status === "fulfilled") nextProcess = nextLaunch.value;
        if (javaLaunch.status === "rejected") throw toError(javaLaunch.reason, "Java sidecar 启动失败");
        if (nextLaunch.status === "rejected") throw toError(nextLaunch.reason, "Next.js 服务启动失败");
        const launchedJava = javaProcess;
        const launchedNext = nextProcess;
        if (!launchedJava || !launchedNext) throw new Error("sidecar 启动未返回进程句柄");

        this.reportPhase(context, "java-health", "等待 Java 健康检查");
        this.reportPhase(context, "next-health", "等待 Next.js 健康检查");
        const [javaHealth, nextHealth] = await Promise.allSettled([
          this.dependencies.waitForHealth({ phase: "java", context, process: launchedJava }),
          this.dependencies.waitForHealth({ phase: "next", context, process: launchedNext }),
        ]);
        if (javaHealth.status === "rejected") throw toError(javaHealth.reason, "Java 健康检查失败");
        if (nextHealth.status === "rejected") throw toError(nextHealth.reason, "Next.js 健康检查失败");
        this.reportPhase(context, "ready", "桌面服务健康检查通过");
        return { ...context, javaProcess: launchedJava, nextProcess: launchedNext };
      } catch (error) {
        lastError = error;
        this.reportPhase(context, "attempt-failed", error instanceof Error ? error.message : "启动失败");
        await this.stopAttempt(nextProcess, javaProcess);
      }
    }

    const message = lastError instanceof Error ? lastError.message : "未知错误";
    throw new StartupError(`桌面服务启动失败，已重试 ${this.maxAttempts} 次：${message}`);
  }

  private reportPhase(context: DesktopStartupContext, phase: string, message: string): void {
    this.dependencies.onPhase?.(context, phase, message);
  }

  private async stopAttempt(...processes: Array<ManagedProcess | undefined>): Promise<void> {
    await Promise.allSettled(processes.filter((process): process is ManagedProcess => Boolean(process)).map((process) => process.stop()));
  }
}

function toError(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback);
}
