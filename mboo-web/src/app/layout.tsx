import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 设计决策：UI 走系统雅黑/苹方贴近 QQ 2007；仅保留 mono 给路径与代码
const codeFont = IBM_Plex_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mboo Code 2007 · Agent 工作台",
  description: "QQ 2007 风格的本地 AI Code Agent 工作台",
};

// 设计决策：viewport-fit=cover 才能让 env(safe-area-inset-*) 在刘海机上生效
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#087fd1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${codeFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-text-1">{children}</body>
    </html>
  );
}
