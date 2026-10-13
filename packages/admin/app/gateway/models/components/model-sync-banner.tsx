'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ModelSyncBannerProps = {
	/** 与官方目录有差异的模型数。 */
	updateCount: number;
	/** 涉及的厂商数。 */
	vendorCount: number;
	onOpen: () => void;
};

/** 模型页顶部提示：仅在手动检查发现差异后出现，没有差异时不占位。 */
export function ModelSyncBanner(props: ModelSyncBannerProps) {
	const { updateCount, vendorCount, onOpen } = props;
	const t = useTranslations('models.sync.banner');

	if (updateCount <= 0) return null;

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
					{t('updates', { models: updateCount, vendors: vendorCount })}
				</p>
				<p className="mt-0.5 text-xs text-orange-800/70">{t('hint')}</p>
			</div>
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
