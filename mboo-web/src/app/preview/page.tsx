"use client";

import styles from "./preview.module.css";

/**
 * MasterGo 3:3160 D2C 高保真静态预览
 *
 * 此路由完全基于确认版 D2C HTML 还原，不依赖运行时主题类名，
 * 不依赖 globals.css 或 mboo-office-light.css 的选择器。
 * 所有视觉属性通过内联 style 精确还原 MasterGo 导出值。
 */

const C = {
  white: "#FFFFFF",
  bg: "#F7F7F7",
  border: "#E6E6E6",
  borderLight: "#F2F2F2",
  borderStrong: "#CCCCCC",
  text1: "#080807",
  text2: "#35352C",
  text3: "#575547",
  text4: "#8B8B84",
  text5: "#9E9E9E",
  accent: "#996AF1",
  accentStrong: "#5C15E0",
  accentSoft: "rgba(153,106,241,0.1)",
  accentBorder: "rgba(153,106,241,0.3)",
  selected: "#F4F4F5",
  avatarBg: "#F0F0F5",
  ok: "#1E9E7C",
  okSoft: "rgba(87,219,180,0.16)",
  warning: "#F2984A",
  warningSoft: "rgba(242,152,74,0.12)",
  warningBorder: "rgba(242,152,74,0.3)",
  danger: "#EB5656",
  dangerSoft: "rgba(235,86,86,0.1)",
};

function AvatarM({ size, radius }: { size: number; radius: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        flexShrink: 0,
        justifyContent: "center",
        alignItems: "center",
        background: C.accentSoft,
        border: `1px solid ${C.accentBorder}`,
        borderRadius: radius,
      }}
    >
      <span
        style={{
          color: C.accentStrong,
          fontSize: Math.round(size * 0.5),
          fontWeight: 700,
          lineHeight: `${Math.round(size * 0.6)}px`,
          textAlign: "center",
        }}
      >
        M
      </span>
    </div>
  );
}

function SessionRow({
  title,
  summary,
  time,
  selected,
}: {
  title: string;
  summary: string;
  time: string;
  selected?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "stretch",
        flexShrink: 0,
        alignItems: "center",
        gap: 8,
        padding: 8,
        background: selected ? C.selected : "transparent",
        border: `1px solid ${selected ? C.borderStrong : "rgba(0,0,0,0)"}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          display: "flex",
          flexShrink: 0,
          justifyContent: "center",
          alignItems: "center",
          background: C.avatarBg,
          border: `1px solid ${C.border}`,
          borderRadius: 6,
        }}
      >
        <span style={{ fontSize: 10, color: selected ? C.accentStrong : C.text3 }}>#</span>
      </div>
      <div style={{ display: "flex", flex: 1, flexShrink: 0, flexDirection: "column", gap: 2 }}>
        <span
          style={{
            flexShrink: 0,
            color: selected ? C.accentStrong : C.text1,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: "17px",
          }}
        >
          {title}
        </span>
        <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, lineHeight: "14px" }}>{summary}</span>
      </div>
      <span style={{ flexShrink: 0, color: C.text5, fontSize: 10, textAlign: "right", lineHeight: "13px" }}>
        {time}
      </span>
    </div>
  );
}

function ToolItem({
  name,
  path,
  status,
  statusColor,
  statusBg,
  duration,
}: {
  name: string;
  path: string;
  status: string;
  statusColor: string;
  statusBg: string;
  duration?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "stretch",
        flexShrink: 0,
        flexDirection: "column",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignSelf: "stretch",
          flexShrink: 0,
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: C.borderLight,
        }}
      >
        <span style={{ fontSize: 11, color: C.text3 }}>&#9881;</span>
        <span style={{ flexShrink: 0, color: C.text1, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>
          {name}
        </span>
        <p style={{ flex: 1, flexShrink: 0, color: C.text5, fontSize: 11, lineHeight: "14px", margin: 0 }}>
          {path}
        </p>
        <div
          style={{
            display: "flex",
            flexShrink: 0,
            justifyContent: "center",
            alignItems: "center",
            padding: "2px 6px",
            background: statusColor,
            borderRadius: 4,
          }}
        >
          <span style={{ color: statusBg, fontSize: 11, textAlign: "center", lineHeight: "14px" }}>{status}</span>
        </div>
        {duration ? (
          <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, textAlign: "right", lineHeight: "14px" }}>
            {duration}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function PreviewPage() {
  return (
    <div
      className={styles.root}
      style={{
        width: "100%",
        minHeight: "100dvh",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        background: "#e8e8e8",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
        color: C.text1,
      }}
    >
      {/* 根画板 3:3160 */}
      <div
        data-node-id="3:3160"
        style={{
          width: 1440,
          height: 900,
          display: "flex",
          flexDirection: "column",
          background: C.white,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {/* 标题栏 */}
        <div
          style={{
            height: 60,
            display: "flex",
            alignSelf: "stretch",
            alignItems: "center",
            gap: 10,
            paddingRight: 18,
            paddingLeft: 18,
            background: C.white,
            borderBottom: `1px solid ${C.borderLight}`,
          }}
        >
          <AvatarM size={26} radius={8} />
          <span style={{ flexShrink: 0, color: C.text1, fontSize: 15, fontWeight: 700, lineHeight: "20px" }}>
            Mboo Code
          </span>
          {/* 运行状态胶囊 */}
          <div
            style={{
              height: 24,
              display: "flex",
              flexShrink: 0,
              alignItems: "center",
              gap: 6,
              paddingRight: 10,
              paddingLeft: 10,
              background: C.accentSoft,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: C.accentStrong, display: "inline-block" }} />
            <span style={{ color: C.accentStrong, fontSize: 11, fontWeight: 500, lineHeight: "14px" }}>
              运行中
            </span>
          </div>
          <div style={{ height: 1, display: "flex", flex: 1 }} />
          {/* 窗口动作按钮 */}
          {[
            { label: "\u2261", color: C.text2, bg: C.white, border: C.border },
            { label: "\u25A2", color: C.text2, bg: C.white, border: C.border },
            { label: "\u2715", color: C.danger, bg: C.dangerSoft, border: "rgba(235,86,86,0.18)" },
          ].map((btn, i) => (
            <div
              key={i}
              style={{
                width: 36,
                height: 36,
                display: "flex",
                flexShrink: 0,
                justifyContent: "center",
                alignItems: "center",
                background: btn.bg,
                border: `1px solid ${btn.border}`,
                borderRadius: 999,
                color: btn.color,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {btn.label}
            </div>
          ))}
        </div>

        {/* 主体三栏 */}
        <div style={{ display: "flex", alignSelf: "stretch", flex: 1 }}>
          {/* 左会话栏 */}
          <div
            style={{
              width: 280,
              display: "flex",
              flexShrink: 0,
              alignSelf: "stretch",
              flexDirection: "column",
              background: C.white,
              borderRight: `1px solid ${C.borderLight}`,
            }}
          >
            {/* 身份区 */}
            <div
              style={{
                height: 76,
                display: "flex",
                alignSelf: "stretch",
                alignItems: "center",
                gap: 10,
                paddingRight: 16,
                paddingLeft: 16,
                borderBottom: `1px solid ${C.borderLight}`,
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  display: "flex",
                  flexShrink: 0,
                  justifyContent: "center",
                  alignItems: "center",
                  background: C.avatarBg,
                  border: `1px solid ${C.borderStrong}`,
                  borderRadius: 12,
                }}
              >
                <AvatarM size={26} radius={6} />
              </div>
              <div style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: 4 }}>
                <span style={{ color: C.text1, fontSize: 14, fontWeight: 600, lineHeight: "18px" }}>Mboo Code</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span
                    style={{ width: 7, height: 7, borderRadius: 999, background: C.ok, display: "inline-block" }}
                  />
                  <span style={{ color: C.text4, fontSize: 12, lineHeight: "16px" }}>本地代理在线</span>
                </div>
              </div>
            </div>

            {/* 侧栏操作区 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flex: 1,
                flexDirection: "column",
                gap: 10,
                paddingTop: 10,
                paddingBottom: 10,
                paddingRight: 12,
                paddingLeft: 12,
              }}
            >
              {/* 搜索框 */}
              <div
                style={{
                  height: 40,
                  display: "flex",
                  alignSelf: "stretch",
                  alignItems: "center",
                  gap: 6,
                  paddingRight: 11,
                  paddingLeft: 11,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                }}
              >
                <span style={{ fontSize: 12, color: C.text5 }}>&#128269;</span>
                <p style={{ flex: 1, color: C.text5, fontSize: 12, lineHeight: "16px", margin: 0 }}>搜索会话</p>
              </div>

              {/* 新建与刷新行 */}
              <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, alignItems: "center", gap: 6 }}>
                <div
                  style={{
                    height: 32,
                    display: "flex",
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 4,
                    background: C.accent,
                    borderRadius: 999,
                  }}
                >
                  <span style={{ fontSize: 11, color: C.white }}>&#43;</span>
                  <span style={{ flexShrink: 0, color: C.white, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>
                    新会话
                  </span>
                </div>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    display: "flex",
                    flexShrink: 0,
                    justifyContent: "center",
                    alignItems: "center",
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                    color: C.text2,
                    fontSize: 12,
                  }}
                >
                  &#8635;
                </div>
              </div>

              {/* 会话分类切换 */}
              <div
                style={{
                  height: 32,
                  display: "flex",
                  alignSelf: "stretch",
                  alignItems: "center",
                  gap: 4,
                  padding: 2,
                  background: C.borderLight,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    height: 26,
                    display: "flex",
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    background: C.white,
                    border: `1px solid ${C.borderStrong}`,
                    borderRadius: 6,
                  }}
                >
                  <span style={{ flexShrink: 0, color: C.accentStrong, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>
                    活跃
                  </span>
                </div>
                <div style={{ height: 26, display: "flex", flex: 1, justifyContent: "center", alignItems: "center", borderRadius: 6 }}>
                  <span style={{ flexShrink: 0, color: C.text4, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>
                    归档
                  </span>
                </div>
              </div>

              {/* 分组标题 */}
              <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, alignItems: "center", gap: 5, padding: 4 }}>
                <span style={{ fontSize: 10, color: C.text4 }}>&#9662;</span>
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, lineHeight: "14px" }}>正在进行（4）</span>
              </div>

              {/* 会话列表 */}
              <div style={{ display: "flex", alignSelf: "stretch", flex: 1, flexDirection: "column", gap: 2 }}>
                <SessionRow title="梳理代码结构" summary="mboo-code-main · 16:32" time="16:32" selected />
                <SessionRow title="定位构建失败原因" summary="mboo-web · 15:08" time="15:08" />
                <SessionRow title="补一版接口说明文档" summary="docs · 昨天" time="昨天" />
                <SessionRow title="主题迁移视觉验收" summary="mboo-web · 周四" time="周四" />
              </div>
            </div>
          </div>

          {/* 中央任务区 */}
          <div
            style={{
              display: "flex",
              flex: 1,
              alignSelf: "stretch",
              flexDirection: "column",
              background: C.white,
            }}
          >
            {/* 任务顶栏 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flexShrink: 0,
                alignItems: "center",
                gap: 10,
                paddingTop: 9,
                paddingBottom: 9,
                paddingRight: 16,
                paddingLeft: 16,
                borderBottom: `1px solid ${C.borderLight}`,
              }}
            >
              <span style={{ flexShrink: 0, color: C.text1, fontSize: 14, fontWeight: 600, lineHeight: "18px" }}>
                梳理代码结构
              </span>
              <div
                style={{
                  display: "flex",
                  flexShrink: 0,
                  justifyContent: "center",
                  alignItems: "center",
                  paddingTop: 2,
                  paddingBottom: 2,
                  paddingRight: 6,
                  paddingLeft: 6,
                  background: C.accentSoft,
                  border: `1px solid ${C.accentBorder}`,
                  borderRadius: 4,
                }}
              >
                <span style={{ color: C.accentStrong, fontSize: 11, textAlign: "center", lineHeight: "14px" }}>
                  归档只读
                </span>
              </div>
            </div>

            {/* 消息流容器 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flex: 1,
                justifyContent: "center",
                alignItems: "flex-start",
                background: C.white,
                overflow: "hidden",
              }}
            >
              {/* 消息列 */}
              <div
                style={{
                  width: 736,
                  display: "flex",
                  flexShrink: 0,
                  flexDirection: "column",
                  gap: 12,
                  paddingTop: 14,
                  paddingBottom: 14,
                }}
              >
                {/* 用户消息气泡 */}
                <div
                  style={{
                    display: "flex",
                    alignSelf: "stretch",
                    flexDirection: "column",
                    gap: 4,
                    paddingTop: 10,
                    paddingBottom: 10,
                    paddingRight: 12,
                    paddingLeft: 12,
                    background: C.bg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                  }}
                >
                  <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, alignItems: "center", gap: 8 }}>
                    <span style={{ flexShrink: 0, color: C.text2, fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>
                      我
                    </span>
                    <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, lineHeight: "14px" }}>16:31:42</span>
                  </div>
                  <p style={{ alignSelf: "stretch", flexShrink: 0, color: C.text1, fontSize: 14, lineHeight: "24px", margin: 0 }}>
                    帮我梳理一下 mboo-web 前端的组件结构，重点看 page.tsx 里的消息渲染逻辑。
                  </p>
                </div>

                {/* 助手消息-已完成 */}
                <div style={{ display: "flex", alignSelf: "stretch", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      background: C.avatarBg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                    }}
                  >
                    <AvatarM size={20} radius={4} />
                  </div>
                  <div style={{ display: "flex", flex: 1, flexShrink: 0, flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, alignItems: "center", gap: 8 }}>
                      <span style={{ flexShrink: 0, color: C.accent, fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>
                        Mboo Bot
                      </span>
                      <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, lineHeight: "14px" }}>已完成</span>
                      <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, lineHeight: "14px" }}>16:32:05</span>
                    </div>
                    <p style={{ alignSelf: "stretch", flexShrink: 0, color: C.text1, fontSize: 14, lineHeight: "25px", margin: 0 }}>
                      已梳理完成：page.tsx 是单体组件，消息渲染集中在 MessageBubble 与 ToolTrace。
                    </p>

                    {/* 工具轨迹卡 */}
                    <div
                      style={{
                        display: "flex",
                        alignSelf: "stretch",
                        flexShrink: 0,
                        flexDirection: "column",
                        background: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignSelf: "stretch",
                          flexShrink: 0,
                          alignItems: "center",
                          gap: 8,
                          paddingTop: 8,
                          paddingBottom: 8,
                          paddingRight: 10,
                          paddingLeft: 10,
                          background: C.borderLight,
                        }}
                      >
                        <span style={{ fontSize: 12, color: C.text3 }}>&#9881;</span>
                        <p style={{ flex: 1, color: C.text1, fontSize: 12, fontWeight: 500, lineHeight: "16px", margin: 0 }}>
                          调用了 3 个工具
                        </p>
                        <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, textAlign: "right", lineHeight: "14px" }}>
                          3
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignSelf: "stretch",
                          flexShrink: 0,
                          flexDirection: "column",
                          gap: 6,
                          padding: 6,
                          background: C.white,
                        }}
                      >
                        <ToolItem name="读取文件" path="· mboo-web/src/app/page.tsx" status="已完成" statusColor={C.okSoft} statusBg={C.ok} duration="320ms" />
                        <ToolItem name="编辑文件" path="· mboo-web/src/app/page.tsx" status="等待授权" statusColor={C.warningSoft} statusBg={C.warning} />
                        <ToolItem name="执行命令" path="· npx tsc --noEmit" status="失败" statusColor={C.dangerSoft} statusBg={C.danger} duration="1.2s" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 助手消息-生成中 */}
                <div style={{ display: "flex", alignSelf: "stretch", gap: 10 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      background: C.avatarBg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                    }}
                  >
                    <AvatarM size={20} radius={4} />
                  </div>
                  <div style={{ display: "flex", flex: 1, flexShrink: 0, flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, alignItems: "center", gap: 8 }}>
                      <span style={{ flexShrink: 0, color: C.accent, fontSize: 12, fontWeight: 600, lineHeight: "16px" }}>
                        Mboo Bot
                      </span>
                      <span style={{ flexShrink: 0, color: C.accent, fontSize: 11, lineHeight: "14px" }}>生成中</span>
                    </div>
                    <p style={{ alignSelf: "stretch", flexShrink: 0, color: C.text1, fontSize: 14, lineHeight: "25px", margin: 0 }}>
                      好的，我先读取 page.tsx 并梳理 MessageBubble 的渲染逻辑，稍等片刻…
                    </p>
                    {/* 运行状态行 */}
                    <div
                      style={{
                        display: "flex",
                        alignSelf: "stretch",
                        flexShrink: 0,
                        justifyContent: "space-between",
                        alignItems: "center",
                        paddingTop: 6,
                        paddingBottom: 6,
                        paddingRight: 10,
                        paddingLeft: 10,
                        background: C.accentSoft,
                        border: `1px solid ${C.accentBorder}`,
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: C.accent,
                            display: "inline-block",
                          }}
                        />
                        <span style={{ color: C.accentStrong, fontSize: 12, lineHeight: "16px" }}>
                          正在生成回复 · 工具：编辑文件（等待授权）
                        </span>
                      </div>
                      <div
                        style={{
                          height: 30,
                          display: "flex",
                          flexShrink: 0,
                          justifyContent: "center",
                          alignItems: "center",
                          gap: 5,
                          paddingRight: 10,
                          paddingLeft: 10,
                          background: C.white,
                          border: `1px solid ${C.accentBorder}`,
                          borderRadius: 999,
                        }}
                      >
                        <span style={{ fontSize: 10, color: C.accentStrong }}>&#9632;</span>
                        <span style={{ color: C.accentStrong, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>
                          停止
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 输入区 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flexShrink: 0,
                flexDirection: "column",
                gap: 8,
                paddingTop: 8,
                paddingRight: 16,
                paddingLeft: 16,
                background: C.white,
                borderTop: `1px solid ${C.borderLight}`,
              }}
            >
              {/* 授权卡 */}
              <div
                style={{
                  width: 736,
                  display: "flex",
                  flexShrink: 0,
                  flexDirection: "column",
                  gap: 8,
                  padding: 12,
                  background: C.accentSoft,
                  border: `1px solid ${C.accentBorder}`,
                  borderRadius: 12,
                }}
              >
                <div style={{ display: "flex", alignSelf: "stretch", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexShrink: 0, flexDirection: "column", gap: 2 }}>
                    <span style={{ color: C.accentStrong, fontSize: 14, fontWeight: 600, lineHeight: "18px" }}>
                      需要工具授权
                    </span>
                    <span style={{ color: C.text4, fontSize: 11, lineHeight: "14px" }}>
                      执行命令 · npx tsc --noEmit
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingTop: 2,
                      paddingBottom: 2,
                      paddingRight: 6,
                      paddingLeft: 6,
                      background: C.white,
                      border: `1px solid ${C.warningBorder}`,
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: C.warning, fontSize: 11, textAlign: "center", lineHeight: "14px" }}>
                      等待授权
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignSelf: "stretch",
                    flexDirection: "column",
                    paddingTop: 8,
                    paddingBottom: 8,
                    paddingRight: 10,
                    paddingLeft: 10,
                    background: C.white,
                    border: `1px solid ${C.accentBorder}`,
                    borderRadius: 6,
                  }}
                >
                  <p style={{ alignSelf: "stretch", flexShrink: 0, color: C.text1, fontSize: 12, lineHeight: "20px", margin: 0 }}>
                    npx tsc --noEmit
                  </p>
                </div>
                <div style={{ display: "flex", alignSelf: "stretch", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      height: 32,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingRight: 12,
                      paddingLeft: 12,
                      background: C.accent,
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ color: C.white, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>仅允许本次</span>
                  </div>
                  <div
                    style={{
                      height: 32,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingRight: 12,
                      paddingLeft: 12,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ color: C.ok, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>本会话允许</span>
                  </div>
                  <div
                    style={{
                      height: 32,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingRight: 12,
                      paddingLeft: 12,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ color: C.danger, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>拒绝</span>
                  </div>
                </div>
              </div>

              {/* 配置独立条 */}
              <div
                style={{
                  width: 736,
                  height: 40,
                  display: "flex",
                  flexShrink: 0,
                  alignItems: "center",
                  gap: 8,
                  paddingRight: 12,
                  paddingLeft: 12,
                  background: C.bg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                }}
              >
                <span style={{ color: C.text4, fontSize: 11, lineHeight: "14px" }}>模型</span>
                <span style={{ color: C.text1, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>gpt-4.1</span>
                <div style={{ width: 1, height: 14, background: C.border }} />
                <span style={{ color: C.text4, fontSize: 11, lineHeight: "14px" }}>推理</span>
                <span style={{ color: C.text1, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>默认</span>
                <div style={{ height: 1, display: "flex", flex: 1 }} />
                <span style={{ color: C.text4, fontSize: 11, lineHeight: "14px" }}>工作区</span>
                <span style={{ color: C.text2, fontSize: 11, lineHeight: "14px" }}>~/gitWork/mboo</span>
                <div
                  style={{
                    height: 28,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 4,
                    paddingRight: 10,
                    paddingLeft: 10,
                    background: C.white,
                    border: `1px solid ${C.border}`,
                    borderRadius: 999,
                  }}
                >
                  <span style={{ fontSize: 11, color: C.text2 }}>&#128193;</span>
                  <span style={{ color: C.text2, fontSize: 11, textAlign: "center", lineHeight: "14px" }}>选择目录</span>
                </div>
              </div>

              {/* 任务输入器 */}
              <div
                style={{
                  width: 736,
                  display: "flex",
                  flexShrink: 0,
                  flexDirection: "column",
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {/* 输入器工具栏 */}
                <div
                  style={{
                    height: 38,
                    display: "flex",
                    alignSelf: "stretch",
                    alignItems: "center",
                    gap: 8,
                    paddingRight: 12,
                    paddingLeft: 12,
                    borderBottom: `1px solid ${C.borderLight}`,
                  }}
                >
                  <div
                    style={{
                      height: 30,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingRight: 10,
                      paddingLeft: 10,
                      background: C.white,
                      border: `1px solid ${C.border}`,
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ color: C.text2, fontSize: 12, textAlign: "center", lineHeight: "16px" }}>清空</span>
                  </div>
                  <div style={{ height: 1, display: "flex", flex: 1 }} />
                  <span style={{ flexShrink: 0, color: C.text5, fontSize: 11, lineHeight: "14px" }}>
                    ⌘/Ctrl + Enter 发送
                  </span>
                </div>

                {/* 输入编辑区 */}
                <div
                  style={{
                    height: 104,
                    display: "flex",
                    alignSelf: "stretch",
                    flexDirection: "column",
                    padding: 14,
                    borderBottom: `1px solid ${C.borderLight}`,
                  }}
                >
                  <p style={{ alignSelf: "stretch", flexShrink: 0, color: C.text5, fontSize: 14, lineHeight: "24px", margin: 0 }}>
                    写下任务目标，或继续追问…
                  </p>
                </div>

                {/* 输入器操作行 */}
                <div
                  style={{
                    display: "flex",
                    alignSelf: "stretch",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: 8,
                    paddingBottom: 8,
                    paddingRight: 12,
                    paddingLeft: 12,
                  }}
                >
                  <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, lineHeight: "14px" }}>
                    mboo-code-main · gpt-4.1
                  </span>
                  <div
                    style={{
                      height: 30,
                      display: "flex",
                      flexShrink: 0,
                      justifyContent: "center",
                      alignItems: "center",
                      gap: 5,
                      paddingRight: 16,
                      paddingLeft: 16,
                      background: C.accent,
                      borderRadius: 999,
                    }}
                  >
                    <span style={{ fontSize: 11, color: C.white }}>&#8593;</span>
                    <span style={{ color: C.white, fontSize: 12, fontWeight: 500, lineHeight: "16px" }}>发送</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右上下文栏 */}
          <div
            style={{
              width: 250,
              display: "flex",
              flexShrink: 0,
              alignSelf: "stretch",
              flexDirection: "column",
              background: C.bg,
              borderLeft: `1px solid ${C.borderLight}`,
            }}
          >
            {/* 当前上下文模块 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flexShrink: 0,
                flexDirection: "column",
                borderBottom: `1px solid ${C.borderLight}`,
              }}
            >
              <div
                style={{
                  height: 32,
                  display: "flex",
                  alignSelf: "stretch",
                  alignItems: "center",
                  paddingRight: 12,
                  paddingLeft: 12,
                }}
              >
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, fontWeight: 600, lineHeight: "14px" }}>
                  当前上下文
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignSelf: "stretch",
                  flexShrink: 0,
                  flexDirection: "column",
                  gap: 4,
                  paddingBottom: 12,
                  paddingRight: 12,
                  paddingLeft: 12,
                }}
              >
                <span style={{ flexShrink: 0, color: C.text1, fontSize: 14, fontWeight: 600, lineHeight: "18px" }}>
                  Mboo Bot
                </span>
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, lineHeight: "15px" }}>模型：gpt-4.1</span>
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, lineHeight: "15px" }}>
                  工作区：mboo-code-main
                </span>
              </div>
            </div>

            {/* 最近会话模块 */}
            <div
              style={{
                display: "flex",
                alignSelf: "stretch",
                flexShrink: 0,
                flexDirection: "column",
                borderBottom: `1px solid ${C.borderLight}`,
              }}
            >
              <div
                style={{
                  height: 32,
                  display: "flex",
                  alignSelf: "stretch",
                  alignItems: "center",
                  paddingRight: 12,
                  paddingLeft: 12,
                }}
              >
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, fontWeight: 600, lineHeight: "14px" }}>
                  最近会话
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignSelf: "stretch",
                  flexShrink: 0,
                  flexDirection: "column",
                  gap: 2,
                  paddingBottom: 8,
                  paddingRight: 6,
                  paddingLeft: 6,
                }}
              >
                {[
                  { title: "梳理代码结构", selected: true, iconColor: C.accentStrong },
                  { title: "定位构建失败原因", selected: false, iconColor: C.text3 },
                  { title: "补一版接口说明", selected: false, iconColor: C.text3 },
                ].map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignSelf: "stretch",
                      flexShrink: 0,
                      alignItems: "center",
                      gap: 8,
                      padding: 6,
                      background: item.selected ? C.selected : "transparent",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        display: "flex",
                        flexShrink: 0,
                        justifyContent: "center",
                        alignItems: "center",
                        background: C.white,
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontSize: 10, color: item.iconColor }}>#</span>
                    </div>
                    <p style={{ flex: 1, color: C.text1, fontSize: 12, lineHeight: "16px", margin: 0 }}>{item.title}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 通知中心模块 */}
            <div style={{ display: "flex", alignSelf: "stretch", flexShrink: 0, flexDirection: "column" }}>
              <div
                style={{
                  height: 32,
                  display: "flex",
                  alignSelf: "stretch",
                  alignItems: "center",
                  paddingRight: 12,
                  paddingLeft: 12,
                }}
              >
                <span style={{ flexShrink: 0, color: C.text4, fontSize: 11, fontWeight: 600, lineHeight: "14px" }}>
                  通知中心
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignSelf: "stretch",
                  flexShrink: 0,
                  flexDirection: "column",
                  gap: 6,
                  paddingBottom: 10,
                  paddingRight: 8,
                  paddingLeft: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignSelf: "stretch",
                    flexShrink: 0,
                    alignItems: "center",
                    gap: 8,
                    padding: 8,
                    background: C.warningSoft,
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: C.warning }}>&#9888;</span>
                  <p style={{ flex: 1, color: C.warning, fontSize: 12, lineHeight: "16px", margin: 0 }}>
                    1 个工具等待授权
                  </p>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignSelf: "stretch",
                    flexShrink: 0,
                    alignItems: "center",
                    gap: 8,
                    padding: 8,
                    background: C.accentSoft,
                    borderRadius: 8,
                  }}
                >
                  <span style={{ fontSize: 12, color: C.accentStrong }}>&#9679;</span>
                  <p style={{ flex: 1, color: C.accentStrong, fontSize: 12, lineHeight: "16px", margin: 0 }}>
                    任务运行中
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
