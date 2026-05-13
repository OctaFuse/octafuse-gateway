/**
 * 全站根布局：系统无衬线字体栈（避免 next/font/google 构建时拉取 Google Fonts，离线/受限网络下可正常 build）。
 */
import './globals.css';
import type { Metadata } from 'next';
import AuthWrapper from '@/components/layout/AuthWrapper';

export const metadata: Metadata = {
  title: 'Gateway Admin',
  description: 'Gateway admin dashboard for Octafuse (keys, providers, models, routes)',
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
