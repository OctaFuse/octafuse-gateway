'use client';

import { ArrowPathIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';

type ProviderSyncCheckButtonProps = {
	checking: boolean;
	/** 本次页面会话里最近一次手动检查的时间；null = 还没检查过。 */
	lastCheckedAt: Date | null;
	/** 最近一次检查是否发现了需要处理的项。 */
	hasUpdates: boolean;
	onCheck: () => void;
};

/** 手动「检查官方更新」入口；检查结果以按钮旁的状态文字加页面提示条呈现。 */
export function ProviderSyncCheckButton(props: ProviderSyncCheckButtonProps) {
	const { checking, lastCheckedAt, hasUpdates, onCheck } = props;
	const t = useTranslations('providers.sync.check');
	const locale = useLocale();

	const time = lastCheckedAt
		? lastCheckedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
		: null;

	return (
		<div className="flex flex-col items-end gap-1">
			<button
				type="button"
				onClick={onCheck}
				disabled={checking}
				className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-60"
			>
				<ArrowPathIcon className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden />
				{checking ? t('checking') : t('button')}
			</button>
			{time ? (
				<p
					className={`inline-flex items-center gap-1 text-xs ${hasUpdates ? 'text-orange-700' : 'text-emerald-700'}`}
					aria-live="polite"
				>
					{hasUpdates ? null : <CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />}
					{hasUpdates ? t('lastCheckedUpdates', { time }) : t('lastCheckedUpToDate', { time })}
				</p>
			) : (
				<p className="text-xs text-gray-400">{t('neverChecked')}</p>
			)}
		</div>
	);
}
