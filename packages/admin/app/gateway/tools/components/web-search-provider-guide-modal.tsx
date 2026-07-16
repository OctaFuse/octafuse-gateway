'use client';

/**
 * Tools → Web Search：各搜索引擎特点说明（点击弹出）。
 */
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
	WEB_SEARCH_PROVIDER_DOCS_URL,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@/lib/web-search-options';

type Props = {
	open: boolean;
	activeProvider: WebSearchProvider;
	onClose: () => void;
};

const GUIDE_ORDER: readonly WebSearchProvider[] = WEB_SEARCH_PROVIDERS;

export function WebSearchProviderGuideModal({ open, activeProvider, onClose }: Props) {
	const t = useTranslations('tools.webSearch.providerGuide');
	const tProviders = useTranslations('tools.webSearch.providers');
	const tCommon = useTranslations('common');

	useEffect(() => {
		if (!open) {
			return;
		}
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) {
		return null;
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
			role="presentation"
		>
			<div
				className="flex max-h-[min(90vh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="web-search-provider-guide-title"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
					<div>
						<h2 id="web-search-provider-guide-title" className="text-base font-semibold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">{t('subtitle')}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>

				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
					<p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
						{t('disclaimer')}
					</p>

					{GUIDE_ORDER.map((id) => {
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

				<div className="shrink-0 border-t border-gray-200 px-5 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
					>
						{tCommon('close')}
					</button>
				</div>
			</div>
		</div>
	);
}
