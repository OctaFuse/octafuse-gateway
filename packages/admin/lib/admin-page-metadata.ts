import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { formatAdminDocumentTitle, type AdminNavNameKey } from './admin-nav';

/**
 * 使用 absolute，避免嵌套布局（如 Tools → Invocations）吃掉根布局 title.template，
 * 导致子页只剩功能名、没有产品后缀。
 */
export async function adminNavMetadata(nameKey: AdminNavNameKey): Promise<Metadata> {
	const tMeta = await getTranslations('metadata');
	const t = await getTranslations('sidebar');
	return {
		title: {
			absolute: formatAdminDocumentTitle(t(`nav.${nameKey}`), tMeta('title')),
		},
	};
}

export function AdminPassthroughLayout({ children }: { children: ReactNode }) {
	return children;
}
