'use client';

import { CpuChipIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type ModelToolMode = 'models' | 'tools';

export function ModelToolModeSwitch({
	value,
	onChange,
	disabled = false,
}: {
	value: ModelToolMode;
	onChange: (value: ModelToolMode) => void;
	disabled?: boolean;
}) {
	const t = useTranslations('modelToolMode');
	return (
		<div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-1" role="group" aria-label={t('label')}>
			{(
				[
					{ id: 'models', icon: CpuChipIcon },
					{ id: 'tools', icon: WrenchScrewdriverIcon },
				] as const
			).map((option) => (
				<button
					key={option.id}
					type="button"
					disabled={disabled}
					aria-pressed={value === option.id}
					onClick={() => onChange(option.id)}
					className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-50 ${
						value === option.id ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-950'
					}`}
				>
					<option.icon className="h-4 w-4" aria-hidden="true" />
					{t(option.id)}
				</button>
			))}
		</div>
	);
}
