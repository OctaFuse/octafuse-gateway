'use client';

/**
 * 客户端导航时立刻把标签写成「页面功能 · 产品名」。
 * Next.js 若再用根布局默认 title 覆盖，这里会写回，避免标签栏闪回。
 */
import { useLayoutEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { formatAdminDocumentTitle, matchAdminNavRoute } from '@/lib/admin-nav';

export default function DocumentTitle() {
	const pathname = usePathname();
	const locale = useLocale();
	const tMeta = useTranslations('metadata');
	const tSidebar = useTranslations('sidebar');

	useLayoutEffect(() => {
		const app = tMeta('title');
		const match = matchAdminNavRoute(pathname ?? '');
		const page = match ? tSidebar(`nav.${match.nameKey}`) : null;
		const desired = formatAdminDocumentTitle(page, app);

		const apply = () => {
			if (document.title !== desired) {
				document.title = desired;
			}
		};

		apply();

		const titleEl = document.querySelector('title');
		if (!titleEl) {
			return;
		}

		const observer = new MutationObserver(apply);
		observer.observe(titleEl, { subtree: true, childList: true, characterData: true });
		return () => observer.disconnect();
	}, [locale, pathname, tMeta, tSidebar]);

	return null;
}
