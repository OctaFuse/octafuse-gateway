'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUturnLeftIcon, CheckIcon } from '@heroicons/react/24/outline';

export function ToolProviderSaveActions({
	saving,
	canSaveConfig,
	onSaveConfig,
	feedback,
	dirty,
	onDiscard,
	hint,
}: {
	saving: boolean;
	canSaveConfig: boolean;
	onSaveConfig: () => void;
	feedback?: ReactNode;
	dirty: boolean;
	onDiscard: () => void;
	hint: string;
}) {
	const t = useTranslations('tools.providerCards');
	const ui = useTranslations('tools.ui');
	const common = useTranslations('common');
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-gray-600">{hint}</p>
			{dirty ? <p className="text-xs text-amber-700">{ui('draftHint')}</p> : null}
			<div className="flex flex-wrap items-center justify-end gap-2">
				{dirty ? (
					<button
						type="button"
						onClick={onDiscard}
						disabled={saving}
						className="mr-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40"
					>
						<ArrowUturnLeftIcon className="h-4 w-4" aria-hidden="true" />
						{ui('discard')}
					</button>
				) : null}
				<button
					type="button"
					onClick={onSaveConfig}
					disabled={saving || !canSaveConfig || !dirty}
					className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-40"
				>
					<CheckIcon className="h-4 w-4" aria-hidden="true" />
					{saving ? common('saving') : t('saveConfig')}
				</button>
			</div>
			{feedback ? <div className="text-xs">{feedback}</div> : null}
		</div>
	);
}
