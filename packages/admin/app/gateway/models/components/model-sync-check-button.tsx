'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ModelSyncCheckButtonProps = {
	checking: boolean;
	onCheck: () => void;
};

/** Checking feedback lives here; results are shown by the banner or notification. */
export function ModelSyncCheckButton({
	checking,
	onCheck,
}: ModelSyncCheckButtonProps) {
	const t = useTranslations('models.sync.check');
	return (
		<button
			type="button"
			onClick={onCheck}
			title={t('tooltip')}
			disabled={checking}
			className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-wait disabled:opacity-60"
		>
			<ArrowPathIcon
				className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`}
				aria-hidden
			/>
			{checking ? t('checking') : t('button')}
		</button>
	);
}
