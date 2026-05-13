/**
 * 全站根布局：系统无衬线字体栈（避免 next/font/google 构建时拉取 Google Fonts，离线/受限网络下可正常 build）。
 */
import './globals.css';
import type { Metadata } from 'next';
import AuthWrapper from '@/components/layout/AuthWrapper';
import { OCTAFUSE_ADMIN_BROWSER_TITLE, OCTAFUSE_ADMIN_DESCRIPTION } from '@/lib/brand';

export const metadata: Metadata = {
  title: OCTAFUSE_ADMIN_BROWSER_TITLE,
  description: OCTAFUSE_ADMIN_DESCRIPTION,
  robots: 'noindex, nofollow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh" data-scroll-behavior="smooth">
      <body className="font-sans h-dvh overflow-hidden">
        <AuthWrapper>{children}</AuthWrapper>
      </body>
    </html>
  );
}
