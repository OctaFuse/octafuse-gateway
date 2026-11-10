'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUturnLeftIcon } from '@heroicons/react/24/outline';

export function ToolProviderSaveActions({
	saving,
	selectedIsActive,
	canSaveConfig,
	canSaveAndActivate,
	onSaveConfig,
	onSaveAndActivate,
	feedback,
	dirty,
	onDiscard,
}: {
	saving: boolean;
	selectedIsActive: boolean;
	canSaveConfig: boolean;
	canSaveAndActivate: boolean;
	onSaveConfig: () => void;
	onSaveAndActivate: () => void;
	feedback?: ReactNode;
	dirty: boolean;
	onDiscard: () => void;
}) {
	const t = useTranslations('tools.providerCards');
	const ui = useTranslations('tools.ui');
	const tCommon = useTranslations('common');
	const primary =
		'inline-flex min-h-9 items-center justify-center rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-40';
	return (
		<div className="space-y-3">
			<p className="text-xs leading-5 text-gray-500">{dirty ? ui('draftHint') : ui('saveHint')}</p>
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
				{!selectedIsActive ? (
					<button
						type="button"
						onClick={onSaveConfig}
						disabled={saving || !canSaveConfig || !dirty}
						className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
					>
						{t('saveConfigOnly')}
					</button>
				) : null}
				<button
					type="button"
					onClick={selectedIsActive ? onSaveConfig : onSaveAndActivate}
					disabled={saving || (selectedIsActive ? !canSaveConfig || !dirty : !canSaveAndActivate)}
					className={primary}
				>
					{saving ? tCommon('saving') : selectedIsActive ? t('saveConfig') : t('saveAndActivate')}
				</button>
			</div>
			{feedback ? <div className="text-xs">{feedback}</div> : null}
		</div>
	);
}
