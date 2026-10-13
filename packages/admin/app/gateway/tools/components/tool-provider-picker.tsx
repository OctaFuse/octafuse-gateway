'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export function ToolProviderSaveActions({
	saving,
	selectedIsActive,
	canSaveConfig,
	canSaveAndActivate,
	onSaveConfig,
	onSaveAndActivate,
	feedback,
}: {
	saving: boolean;
	selectedIsActive: boolean;
	canSaveConfig: boolean;
	canSaveAndActivate: boolean;
	onSaveConfig: () => void;
	onSaveAndActivate: () => void;
	feedback?: ReactNode;
}) {
	const t = useTranslations('tools.providerCards');
	const tCommon = useTranslations('common');

	return (
		<div className="flex flex-wrap items-center gap-3">
			{selectedIsActive ? (
				<button
					type="button"
					onClick={onSaveConfig}
					disabled={saving || !canSaveConfig}
					className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
				>
					{saving ? tCommon('saving') : t('saveConfig')}
				</button>
			) : (
				<>
					<button
						type="button"
						onClick={onSaveAndActivate}
						disabled={saving || !canSaveAndActivate}
						className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{saving ? tCommon('saving') : t('saveAndActivate')}
					</button>
					<button
						type="button"
						onClick={onSaveConfig}
						disabled={saving || !canSaveConfig}
						className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
					>
						{t('saveConfigOnly')}
					</button>
				</>
			)}
			{feedback}
		</div>
	);
}
