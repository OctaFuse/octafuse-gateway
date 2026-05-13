'use client';

/**
 * 紧凑时间范围：快捷预设 + 自定义起止（datetime-local），产出与 Gateway 分析 API 一致的 UTC `YYYY-MM-DD HH:mm:ss`。
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
	apiUtcToDatetimeLocal,
	datetimeLocalToApiUtc,
	detectRollingPreset,
	GATEWAY_TIME_RANGE_PRESETS,
	normalizeCustomApiRange,
	rangeToParams,
	type GatewayTimeRangePreset,
	type GatewayTimeRangeValue,
} from '@/lib/analytics-range';

const SHORT_LABEL: Record<Exclude<GatewayTimeRangePreset, 'custom'>, string> = {
	'1h': '1h',
	'1d': '1d',
	'7d': '7d',
	'14d': '14d',
	'30d': '30d',
	'90d': '90d',
};

const btnBase =
	'px-2 py-1 text-xs font-medium rounded border transition-colors shrink-0';
const btnIdle = 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-100';
const btnOn = 'border-gray-300 bg-white text-gray-900 shadow-sm';

/** 与 `GET /admin/stats?range=` 一致的快捷键（无 custom）。 */
export type GatewayDashboardStatsRange = Exclude<GatewayTimeRangePreset, 'custom'>;

export type GatewayDashboardRangePickerProps = {
	value: GatewayDashboardStatsRange;
	onChange: (range: GatewayDashboardStatsRange) => void;
	/** 整块右对齐（少见）；默认左对齐，适合筛选项第一行 */
	align?: 'start' | 'end';
	className?: string;
};

export function GatewayDashboardRangePicker({
	value,
	onChange,
	align = 'start',
	className = '',
}: GatewayDashboardRangePickerProps) {
	const presets = GATEWAY_TIME_RANGE_PRESETS;
	const end = align === 'end';
	return (
		<div
			className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${end ? 'justify-end' : 'justify-start'} ${className}`}
		>
			<span className="text-sm text-gray-500 shrink-0">Time range</span>
			<div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
				{presets.map((p) => (
					<button
						key={p}
						type="button"
						onClick={() => onChange(p)}
						className={`${btnBase} ${value === p ? btnOn : btnIdle}`}
					>
						{SHORT_LABEL[p]}
					</button>
				))}
			</div>
		</div>
	);
}

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
	label = 'Time range',
	align = 'start',
	className = '',
}: GatewayTimeRangePickerProps) {
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
		const { start_date, end_date } =
			value.preset === 'custom'
				? { start_date: value.start_date, end_date: value.end_date }
				: rangeToParams(value.preset as Exclude<GatewayTimeRangePreset, 'custom'>);
		setDraftStart(apiUtcToDatetimeLocal(start_date));
		setDraftEnd(apiUtcToDatetimeLocal(end_date));
		onChange({ preset: 'custom', start_date, end_date });
	};

	const applyCustom = () => {
		const next = commitCustomLocal(draftStart, draftEnd);
		if (next) onChange(next);
	};

	const end = align === 'end';
	const customOpen = value.preset === 'custom';

	return (
		<div
			className={`flex w-full min-w-0 flex-wrap items-end gap-x-3 gap-y-2 ${end ? 'justify-end' : ''} ${className}`}
		>
			{label ? (
				<span className={`text-xs text-gray-500 shrink-0 ${end ? 'text-right' : ''}`}>{label}</span>
			) : null}
			<div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
				{presets.map((p) => (
					<button
						key={p}
						type="button"
						onClick={() => selectPreset(p)}
						className={`${btnBase} ${value.preset === p ? btnOn : btnIdle}`}
					>
						{SHORT_LABEL[p]}
					</button>
				))}
				{showCustom ? (
					<button
						type="button"
						onClick={enterCustom}
						className={`${btnBase} ${value.preset === 'custom' ? btnOn : btnIdle}`}
					>
						Custom
					</button>
				) : null}
			</div>
			{customOpen && (
				<div className="flex shrink-0 flex-wrap items-end gap-2">
					<div className="flex flex-col gap-0.5">
						<label className="text-[11px] text-gray-500">Start</label>
						<input
							type="datetime-local"
							value={draftStart}
							onChange={(e) => setDraftStart(e.target.value)}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
					</div>
					<div className="flex flex-col gap-0.5">
						<label className="text-[11px] text-gray-500">End</label>
						<input
							type="datetime-local"
							value={draftEnd}
							onChange={(e) => setDraftEnd(e.target.value)}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
					</div>
					<button
						type="button"
						onClick={applyCustom}
						className="px-3 py-1 bg-gray-900 text-white text-xs rounded-md hover:bg-gray-800"
					>
						Apply
					</button>
				</div>
			)}
		</div>
	);
}

export type GatewayTimeRangeFilterProps = {
	startDate: string;
	endDate: string;
	onCommit: (start_date: string, end_date: string) => void;
	presets?: Array<Exclude<GatewayTimeRangePreset, 'custom'>>;
	showCustom?: boolean;
	/** 整块右对齐；默认与筛选项第一行左对齐 */
	align?: 'start' | 'end';
	className?: string;
};

export function GatewayTimeRangeFilter({
	startDate,
	endDate,
	onCommit,
	presets = [...GATEWAY_TIME_RANGE_PRESETS],
	showCustom = true,
	align = 'start',
	className = '',
}: GatewayTimeRangeFilterProps) {
	const [draftStart, setDraftStart] = useState('');
	const [draftEnd, setDraftEnd] = useState('');
	const [customUi, setCustomUi] = useState(false);

	const rolling = useMemo(
		() => (startDate && endDate ? detectRollingPreset(startDate, endDate) : null),
		[startDate, endDate]
	);

	const nonRolling = Boolean(startDate && endDate && !rolling);
	const showCustomRow = customUi || nonRolling;

	useEffect(() => {
		if (startDate && endDate) {
			setDraftStart(apiUtcToDatetimeLocal(startDate));
			setDraftEnd(apiUtcToDatetimeLocal(endDate));
		}
	}, [startDate, endDate]);

	useEffect(() => {
		if (!startDate && !endDate) setCustomUi(false);
	}, [startDate, endDate]);

	const selectPreset = useCallback(
		(p: Exclude<GatewayTimeRangePreset, 'custom'>) => {
			setCustomUi(false);
			const { start_date, end_date } = rangeToParams(p);
			onCommit(start_date, end_date);
		},
		[onCommit]
	);

	const enterCustom = () => {
		setCustomUi(true);
		const base =
			startDate && endDate
				? { start_date: startDate, end_date: endDate }
				: rangeToParams('1d');
		setDraftStart(apiUtcToDatetimeLocal(base.start_date));
		setDraftEnd(apiUtcToDatetimeLocal(base.end_date));
		onCommit(base.start_date, base.end_date);
	};

	const applyCustom = () => {
		const next = commitCustomLocal(draftStart, draftEnd);
		if (next) {
			setCustomUi(true);
			onCommit(next.start_date, next.end_date);
		}
	};

	const presetActive = (p: Exclude<GatewayTimeRangePreset, 'custom'>) =>
		!customUi && rolling === p;
	const customActive = customUi || nonRolling;

	const end = align === 'end';

	return (
		<div
			className={`flex w-full min-w-0 flex-wrap items-end gap-x-3 gap-y-2 ${end ? 'justify-end' : ''} ${className}`}
		>
			<div className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
				{presets.map((p) => (
					<button
						key={p}
						type="button"
						onClick={() => selectPreset(p)}
						className={`${btnBase} ${presetActive(p) ? btnOn : btnIdle}`}
					>
						{SHORT_LABEL[p]}
					</button>
				))}
				{showCustom ? (
					<button
						type="button"
						onClick={enterCustom}
						className={`${btnBase} ${customActive ? btnOn : btnIdle}`}
					>
						Custom
					</button>
				) : null}
			</div>
			{showCustomRow && (
				<div className="flex shrink-0 flex-wrap items-end gap-2">
					<div className="flex flex-col gap-0.5">
						<label className="text-[11px] text-gray-500">Start</label>
						<input
							type="datetime-local"
							value={draftStart}
							onChange={(e) => setDraftStart(e.target.value)}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
					</div>
					<div className="flex flex-col gap-0.5">
						<label className="text-[11px] text-gray-500">End</label>
						<input
							type="datetime-local"
							value={draftEnd}
							onChange={(e) => setDraftEnd(e.target.value)}
							className="px-2 py-1 border border-gray-300 rounded-md text-xs w-[11.5rem]"
						/>
					</div>
					<button
						type="button"
						onClick={applyCustom}
						className="px-3 py-1 bg-gray-900 text-white text-xs rounded-md hover:bg-gray-800"
					>
						Apply
					</button>
				</div>
			)}
		</div>
	);
}
