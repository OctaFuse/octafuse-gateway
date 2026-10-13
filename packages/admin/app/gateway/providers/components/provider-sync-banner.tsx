'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ProviderSyncBannerProps = {
	/** 与官方模板有差异的供应商数。 */
	updateCount: number;
	/** 涉及的供应商类型数。 */
	kindCount: number;
	/** 模板已改名 / 下线、需要迁移类型的供应商数。 */
	orphanCount: number;
	onOpen: () => void;
	onShowOnly: () => void;
};

/** 供应商页顶部提示：仅在有可处理项时出现，没有差异时不占位。 */
export function ProviderSyncBanner(props: ProviderSyncBannerProps) {
	const { updateCount, kindCount, orphanCount, onOpen, onShowOnly } = props;
	const t = useTranslations('providers.sync.banner');

	if (updateCount <= 0 && orphanCount <= 0) return null;

	return (
		<div
			role="status"
			className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3"
		>
			<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
				<ArrowPathIcon className="h-5 w-5" aria-hidden />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-orange-900">
					{updateCount > 0 ? t('updates', { providers: updateCount, kinds: kindCount }) : t('orphansOnly')}
				</p>
				{orphanCount > 0 && updateCount > 0 ? (
					<p className="mt-0.5 text-xs text-orange-800/80">{t('orphans', { count: orphanCount })}</p>
				) : null}
				<p className="mt-0.5 text-xs text-orange-800/70">{t('hint')}</p>
			</div>
			<button
				type="button"
				onClick={onShowOnly}
				className="rounded-md px-2.5 py-1.5 text-xs font-medium text-orange-800 hover:bg-orange-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
			>
				{t('showOnly')}
			</button>
			<button
				type="button"
				onClick={onOpen}
				className="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
			>
				{t('review')}
			</button>
		</div>
	);
}
