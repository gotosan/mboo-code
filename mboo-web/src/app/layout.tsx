import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "markstream-react/index.css";
import "./globals.css";
import "../styles/themes/mboo-office-light.css";

// 设计决策：UI 使用系统中文字体保持工作台的阅读效率；mono 仅保留给路径与代码。
const codeFont = IBM_Plex_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mboo Code · Agent 工作台",
  description: "本地 AI Code Agent 工作台",
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
    <html lang="zh-CN" data-theme="mboo-office-light" className={`${codeFont.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas font-sans text-text-1">{children}</body>
    </html>
  );
}
