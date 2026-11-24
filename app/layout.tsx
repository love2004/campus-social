import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "校園發聲｜大葉大學社群工作台",
  description: "把值得分享的校園日常，變成被看見的故事。AI 內容、多平台發佈與招生成效分析。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
