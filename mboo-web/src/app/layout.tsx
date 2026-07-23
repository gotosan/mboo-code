import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// 设计决策：拉丁用 IBM Plex；中文走系统/Noto 栈（globals），避免中英混排「AI 默认脸」
const uiFont = IBM_Plex_Sans({
  variable: "--font-latin",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const codeFont = IBM_Plex_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mboo Code · 会话工作台",
  description: "本地 AI Code Agent 会话工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${uiFont.variable} ${codeFont.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas font-sans text-text-1">{children}</body>
    </html>
  );
}
