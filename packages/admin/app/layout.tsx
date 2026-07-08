/**
 * 全站根布局：系统无衬线字体栈（避免 next/font/google 构建时拉取 Google Fonts，离线/受限网络下可正常 build）。
 */
import './globals.css';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import AuthWrapper from '@/components/layout/AuthWrapper';

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations('metadata');
	return {
		title: t('title'),
		description: t('description'),
		robots: 'noindex, nofollow',
	};
}

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const locale = await getLocale();
	const messages = await getMessages();

	return (
		<html lang={locale} data-scroll-behavior="smooth">
			<body className="font-sans h-dvh overflow-hidden">
				<NextIntlClientProvider locale={locale} messages={messages}>
					<AuthWrapper>{children}</AuthWrapper>
				</NextIntlClientProvider>
			</body>
		</html>
	);
}
