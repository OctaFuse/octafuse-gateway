'use client';

/**
 * 紧凑时间范围：快捷预设 + 自定义起止（datetime-local），产出与 Gateway 分析 API 一致的 UTC `YYYY-MM-DD HH:mm:ss`。
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
	apiUtcToDatetimeLocal,
	datetimeLocalToApiUtc,
	GATEWAY_TIME_RANGE_PRESETS,
	normalizeCustomApiRange,
	rangeToParams,
	type GatewayTimeRangePreset,
	type GatewayTimeRangeValue,
} from '@/lib/analytics-range';

const btnBase =
	'px-2 py-1 text-xs font-medium rounded border transition-colors shrink-0';
const btnIdle = 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100';
const btnOn = 'border-gray-300 bg-white text-gray-900 shadow-sm';

/** 与 `GET /admin/stats?range=` 一致的快捷键（无 custom）。 */
export type GatewayDashboardStatsRange = Exclude<GatewayTimeRangePreset, 'custom'>;

function commitCustomLocal(draftStart: string, draftEnd: string): GatewayTimeRangeValue | null {
	const s = datetimeLocalToApiUtc(draftStart);
	const e = datetimeLocalToApiUtc(draftEnd);
	if (!s || !e) return null;
	const norm = normalizeCustomApiRange(s, e);
	if (!norm) return null;
	return { preset: 'custom', ...norm };
}

export type GatewayTimeRangePickerProps = {
	value: GatewayTimeRangeValue;
	onChange: (next: GatewayTimeRangeValue) => void;
	presets?: Array<Exclude<GatewayTimeRangePreset, 'custom'>>;
	showCustom?: boolean;
	label?: string;
	/** 整块右对齐；默认与筛选项第一行左对齐 */
	align?: 'start' | 'end';
	className?: string;
};

export function GatewayTimeRangePicker({
	value,
	onChange,
	presets = [...GATEWAY_TIME_RANGE_PRESETS],
	showCustom = true,
	label,
	align = 'start',
	className = '',
}: GatewayTimeRangePickerProps) {
	const t = useTranslations('timeRange');
	const tCommon = useTranslations('common');
	const resolvedLabel = label ?? t('label');
	const [draftStart, setDraftStart] = useState(() => apiUtcToDatetimeLocal(value.start_date));
	const [draftEnd, setDraftEnd] = useState(() => apiUtcToDatetimeLocal(value.end_date));

	useEffect(() => {
		setDraftStart(apiUtcToDatetimeLocal(value.start_date));
		setDraftEnd(apiUtcToDatetimeLocal(value.end_date));
	}, [value.start_date, value.end_date]);

	const selectPreset = (p: Exclude<GatewayTimeRangePreset, 'custom'>) => {
		onChange({ preset: p, ...rangeToParams(p) });
	};

	const enterCustom = () => {
		const hasRange = Boolean(value.start_date?.trim() && value.end_date?.trim());
		const { start_date, end_date } = hasRange
			? { start_date: value.start_date, end_date: value.end_date }
			: rangeToParams('1d');
		setDraftStart(apiUtcToDatetimeLocal(start_date));
		setDraftEnd(apiUtcToDatetimeLocal(end_date));
		onChange({ preset: 'custom', start_date, end_date });
	};

	const applyCustom = () => {
		const next = commitCustomLocal(draftStart, draftEnd);
		if (next) onChange(next);
	};

	const end = align === 'end';
	const customOpen =
		value.preset === 'custom' && Boolean(value.start_date?.trim() && value.end_date?.trim());

	return (
		<div className={`w-full min-w-0 ${className}`}>
			{resolvedLabel ? (
				<label className={`block text-sm text-gray-500 mb-1 ${end ? 'text-right' : ''}`}>{resolvedLabel}</label>
			) : null}
			<div
				className={`flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 ${end ? 'justify-end' : ''}`}
			>
				<div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
					{presets.map((p) => (
						<button
							key={p}
							type="button"
							onClick={() => selectPreset(p)}
							className={`${btnBase} ${value.preset === p ? btnOn : btnIdle}`}
						>
							{t(`presets.${p}`)}
						</button>
					))}
					{showCustom ? (
						<button
							type="button"
							onClick={enterCustom}
							className={`${btnBase} ${value.preset === 'custom' ? btnOn : btnIdle}`}
						>
							{t('custom')}
						</button>
					) : null}
				</div>
				{customOpen && (
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<input
							type="datetime-local"
							value={draftStart}
							onChange={(e) => setDraftStart(e.target.value)}
							aria-label={t('start')}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
						<span aria-hidden="true" className="shrink-0 text-sm text-gray-400">
							→
						</span>
						<input
							type="datetime-local"
							value={draftEnd}
							onChange={(e) => setDraftEnd(e.target.value)}
							aria-label={t('end')}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
						<button
							type="button"
							onClick={applyCustom}
							className="px-3 py-1 bg-gray-900 text-white text-xs rounded-md hover:bg-gray-800"
						>
							{tCommon('apply')}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
