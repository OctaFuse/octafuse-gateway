'use client';

import { useTranslations } from 'next-intl';
import type { TokenDisplayMode } from '@/lib/format-token-count';

const btnBase =
	'px-2 py-1 text-xs font-medium rounded border transition-colors shrink-0';
const btnIdle = 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100';
const btnOn = 'border-gray-300 bg-white text-gray-900 shadow-sm';

export type AnalyticsTokenDisplayPickerProps = {
	value: TokenDisplayMode;
	onChange: (next: TokenDisplayMode) => void;
	label?: string;
	className?: string;
};

export function AnalyticsTokenDisplayPicker({
	value,
	onChange,
	label,
	className = '',
}: AnalyticsTokenDisplayPickerProps) {
	const t = useTranslations('analytics.tokenDisplay');
	const displayLabel = label ?? t('label');
	return (
		<div className={`shrink-0 ${className}`}>
			{displayLabel ? <label className="block text-sm text-gray-500 mb-1">{displayLabel}</label> : null}
			<div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
				<button
					type="button"
					onClick={() => onChange('compact')}
					className={`${btnBase} ${value === 'compact' ? btnOn : btnIdle}`}
				>
					{t('compact')}
				</button>
				<button
					type="button"
					onClick={() => onChange('numeric')}
					className={`${btnBase} ${value === 'numeric' ? btnOn : btnIdle}`}
				>
					{t('numeric')}
				</button>
			</div>
		</div>
	);
}
