/**
 * 打字机特效状态管理 — Particles 粒子散开
 *
 * 管理：粒子池、caret 位置追踪。无 combo、无连击视觉。
 */

import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Particle } from "./typewriter-particle";
import { burstParticles, updateParticles } from "./typewriter-particle";
import type { ParticlesConfig } from "./typewriter-config";
import { PARTICLES_CONFIG } from "./typewriter-config";

// ─── Per‑Session 状态 ──────────────────────────────────

export type SessionEffectState = {
  /** 活跃粒子 */
  particles: Particle[];
  /** 等待 DOM 提交后再消费的 token 粒子触发 */
  hasPendingBurst: boolean;
  /** caret 在消息容器内的位置（CSS 像素，相对于消息列表） */
  caretX: number;
  caretY: number;
};

function createEmptySessionState(): SessionEffectState {
  return {
    particles: [],
    hasPendingBurst: false,
    caretX: 0,
    caretY: 0,
  };
}

// ─── 全局状态 ─────────────────────────────────────────

export type TypewriterEffectState = {
  /** 是否启用特效 */
  enabled: boolean;
  /** 粒子配置 */
  config: ParticlesConfig;
  /** 按 sessionId 分组的状态 */
  sessions: Record<string, SessionEffectState>;

  // ── 动作 ──
  /** 确保 session 有状态槽 */
  ensureSession: (sessionId: string) => void;
  /** 开启/关闭 */
  setEnabled: (enabled: boolean) => void;
  /** token 到达：等待 DOM 提交并定位后散开粒子 */
  onToken: (sessionId: string) => void;
  /** 使用已提交文本末尾的位置生成等待中的粒子 */
  flushPendingBurst: (sessionId: string, caretRect: { x: number; y: number }) => void;
  /** 更新 caret 位置（RAF 循环中每帧调用） */
  updateCaret: (sessionId: string, x: number, y: number) => void;
  /** 滚动容器位移时同步平移存活粒子 */
  translateParticles: (sessionId: string, deltaX: number, deltaY: number) => void;
  /** 单帧物理更新 */
  tick: (sessionId: string, dt: number) => void;
  /** 会话结束/切换时清理 */
  resetSession: (sessionId: string) => void;
  /** pending → 真实 id 时迁移粒子状态 */
  moveSession: (fromId: string, toId: string) => void;
};

// 节流：两次 token 触发之间的最小间隔 ms
const TOKEN_THROTTLE_MS = 80;

const lastBurstAt = new Map<string, number>();

export const typewriterStore = createStore<TypewriterEffectState>()((set, get) => ({
  enabled: true,
  config: PARTICLES_CONFIG,
  sessions: {},

  ensureSession: (sessionId) => {
    if (!sessionId) return;
    set((state) => {
      if (state.sessions[sessionId]) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: createEmptySessionState(),
        },
      };
    });
  },

  setEnabled: (enabled) => {
    set({ enabled });
  },

  onToken: (sessionId) => {
    if (!sessionId || !get().enabled) return;
    if (!get().sessions[sessionId]) {
      get().ensureSession(sessionId);
    }
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, hasPendingBurst: true },
        },
      };
    });
  },

  flushPendingBurst: (sessionId, caretRect) => {
    if (!sessionId || !get().enabled) return;
    const now = performance.now();
    const last = lastBurstAt.get(sessionId) ?? 0;

    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || !session.hasPendingBurst) return state;
      const nextSession = {
        ...session,
        hasPendingBurst: false,
        caretX: caretRect.x,
        caretY: caretRect.y,
      };

      if (now - last < TOKEN_THROTTLE_MS) {
        return { sessions: { ...state.sessions, [sessionId]: nextSession } };
      }

      lastBurstAt.set(sessionId, now);
      const merged = [...session.particles, ...burstParticles(caretRect.x, caretRect.y, state.config)];
      const particles =
        merged.length > state.config.maxAlive
          ? merged.slice(merged.length - state.config.maxAlive)
          : merged;

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...nextSession, particles },
        },
      };
    });
  },

  updateCaret: (sessionId, x, y) => {
    if (!sessionId) return;
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, caretX: x, caretY: y },
        },
      };
    });
  },

  translateParticles: (sessionId, deltaX, deltaY) => {
    if (!sessionId || (deltaX === 0 && deltaY === 0)) return;
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || session.particles.length === 0) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            particles: session.particles.map((particle) => ({
              ...particle,
              x: particle.x + deltaX,
              y: particle.y + deltaY,
            })),
          },
        },
      };
    });
  },

  tick: (sessionId, dt) => {
    if (dt <= 0) return;
    const state = get();
    if (!state.enabled) return;
    const sess = state.sessions[sessionId];
    if (!sess) return;

    const config = state.config;

    let particles = sess.particles;
    if (particles.length > 0) {
      particles = updateParticles(particles, dt, config);
      if (particles.length > config.maxAlive) {
        particles = particles.slice(particles.length - config.maxAlive);
      }
    }

    set({
      sessions: {
        ...get().sessions,
        [sessionId]: {
          ...sess,
          particles,
        },
      },
    });
  },

  resetSession: (sessionId) => {
    if (!sessionId) return;
    lastBurstAt.delete(sessionId);
    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: createEmptySessionState(),
      },
    }));
  },

  moveSession: (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    set((state) => {
      const from = state.sessions[fromId];
      if (!from) return state;
      const next = { ...state.sessions };
      next[toId] = { ...from };
      delete next[fromId];
      const last = lastBurstAt.get(fromId);
      if (last !== undefined) {
        lastBurstAt.set(toId, last);
        lastBurstAt.delete(fromId);
      }
      return { sessions: next };
    });
  },
}));

// ─── React hook ───────────────────────────────────────

export const useTypewriterStore = <T>(selector: (state: TypewriterEffectState) => T) =>
  useStore(typewriterStore, selector);

export function getTypewriterSession(sessionId: string) {
  const state = typewriterStore.getState();
  return state.sessions[sessionId] ?? createEmptySessionState();
}
