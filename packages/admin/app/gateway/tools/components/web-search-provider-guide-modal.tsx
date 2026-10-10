'use client';

import { useTranslations } from 'next-intl';
import {
	WEB_SEARCH_PROVIDER_DOCS_URL,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@/lib/web-search-options';

/** 搜索引擎说明作为服务详情的一部分，避免叠加弹窗。 */
export function WebSearchProviderGuideContent({ activeProvider }: { activeProvider: WebSearchProvider }) {
	const t = useTranslations('tools.webSearch.providerGuide');
	const tProviders = useTranslations('tools.webSearch.providers');
	return (
		<div>
			<h3 className="text-base font-semibold text-gray-900">{t('title')}</h3>
			<p className="mb-4 mt-1 text-sm text-gray-500">{t('subtitle')}</p>
			<div className="space-y-4">
				<p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
					{t('disclaimer')}
				</p>

				{WEB_SEARCH_PROVIDERS.map((id) => {
					const isActive = id === activeProvider;
					const badge = t(`items.${id}.badge`);
					return (
						<section
							key={id}
							className={`rounded-lg border px-4 py-3 ${
								isActive ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-white'
							}`}
						>
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-sm font-semibold text-gray-900">{tProviders(id)}</h3>
								{badge ? (
									<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
										{badge}
									</span>
								) : null}
								{isActive ? (
									<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
										{t('selected')}
									</span>
								) : null}
							</div>
							<p className="mt-2 text-sm leading-relaxed text-gray-700">{t(`items.${id}.summary`)}</p>
							<dl className="mt-2 space-y-1.5 text-xs leading-relaxed text-gray-600">
								<div>
									<dt className="inline font-medium text-gray-800">{t('labels.sources')}：</dt>
									<dd className="inline">{t(`items.${id}.sources`)}</dd>
								</div>
								<div>
									<dt className="inline font-medium text-gray-800">{t('labels.bestFor')}：</dt>
									<dd className="inline">{t(`items.${id}.bestFor`)}</dd>
								</div>
							</dl>
							<a
								href={WEB_SEARCH_PROVIDER_DOCS_URL[id]}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-2 inline-block text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
							>
								{t('docsLink')}
							</a>
						</section>
					);
				})}
			</div>
		</div>
	);
}
