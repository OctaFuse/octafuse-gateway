'use client';

import { ChevronDownIcon } from '@heroicons/react/24/outline';
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
			<p
				id="rest-provider-guide-intro"
				tabIndex={-1}
				className="outline-none mb-4 text-sm leading-6 text-gray-500"
			>
				{t('subtitle')}
			</p>
			<div className="space-y-3">
				<p className="rounded-lg bg-gray-50 px-3 py-3 text-xs leading-5 text-gray-500">{t('disclaimer')}</p>

				{WEB_SEARCH_PROVIDERS.map((id) => {
					const isActive = id === activeProvider;
					const badge = t(`items.${id}.badge`);
					return (
						<details
							open={isActive}
							key={id}
							className={`group rounded-lg border px-4 py-3 ${
								isActive ? 'border-gray-300 bg-gray-50/60' : 'border-gray-200 bg-white'
							}`}
						>
							<summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">
								<span className="font-medium text-gray-900">{tProviders(id)}</span>
								{badge ? (
									<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{badge}</span>
								) : null}
								{isActive ? (
									<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-900">
										{t('selected')}
									</span>
								) : null}
								<ChevronDownIcon
									className="ml-auto h-4 w-4 text-gray-400 group-open:rotate-180"
									aria-hidden="true"
								/>
							</summary>
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
								className="mt-2 inline-block text-xs font-medium text-gray-800 hover:text-gray-900 hover:underline"
							>
								{t('docsLink')}
							</a>
						</details>
					);
				})}
			</div>
		</div>
	);
}
