import { ChevronDownIcon } from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';

/**
 * 筛选条统一控件：「灰色小标签 + 灰底胶囊」。
 * 分段按钮（少量互斥项）、下拉（项目多）、文本输入共用同一高度与选中态（白底 / 蓝字 / 阴影）。
 */

const LABEL_CLASS = 'shrink-0 whitespace-nowrap text-xs text-slate-500';
const PILL_CLASS = 'rounded-lg bg-slate-100/80 p-1';
const ACTIVE_CLASS = 'bg-white font-semibold text-blue-700 shadow-sm';
const IDLE_CLASS = 'bg-transparent text-slate-500 hover:text-slate-900';

/** 一行筛选：各控件之间留足横向间距，放不下时自动换行。 */
export function FilterRow({ children, className = '' }: { children: ReactNode; className?: string }) {
	return <div className={`flex flex-wrap items-center gap-x-5 gap-y-3 ${className}`}>{children}</div>;
}

/** 同类控件成组：放不下时整组换到下一行，而不是单个控件落单。 */
export function FilterGroup({ children }: { children: ReactNode }) {
	return <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3">{children}</div>;
}

export type FilterSegmentedOption = { value: string; label: string; count?: number | string; dotClass?: string };

export function FilterSegmented({
	label,
	value,
	options,
	onChange,
	stretch = false,
}: {
	label: string;
	value: string;
	options: FilterSegmentedOption[];
	onChange: (value: string) => void;
	stretch?: boolean;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
			<span className={LABEL_CLASS}>{label}</span>
			<div className={`${stretch ? 'flex' : 'inline-flex'} flex-wrap gap-1 ${PILL_CLASS}`}>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						aria-pressed={value === option.value}
						onClick={() => onChange(option.value)}
						className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition focus-visible:outline-blue-500 ${
							value === option.value ? ACTIVE_CLASS : 'text-slate-500 hover:text-slate-900'
						}`}
					>
						{option.dotClass ? <span className={`h-1.5 w-1.5 rounded-full ${option.dotClass}`} aria-hidden /> : null}
						{option.label}
						{option.count !== undefined ? (
							<span className="text-[10px] tabular-nums opacity-70">{option.count}</span>
						) : null}
					</button>
				))}
			</div>
		</div>
	);
}

export function FilterSelect({
	label,
	value,
	onChange,
	children,
	widthClass = 'w-32',
	active,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	/** `<option>` 列表（含「全部」）。 */
	children: ReactNode;
	widthClass?: string;
	/** 默认：value 非空即视为已筛选。 */
	active?: boolean;
}) {
	const isActive = active ?? Boolean(value);
	return (
		<label className="flex min-w-0 max-w-full items-center gap-2">
			<span className={LABEL_CLASS}>{label}</span>
			<div className={`relative min-w-0 ${PILL_CLASS}`}>
				<select
					value={value}
					onChange={(event) => onChange(event.target.value)}
					className={`block h-6 ${widthClass} min-w-0 cursor-pointer appearance-none truncate rounded-md pl-2.5 pr-7 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500 ${
						isActive ? ACTIVE_CLASS : IDLE_CLASS
					}`}
				>
					{children}
				</select>
				<ChevronDownIcon
					className={`pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 ${
						isActive ? 'text-blue-600' : 'text-slate-400'
					}`}
					aria-hidden
				/>
			</div>
		</label>
	);
}

export function FilterTextInput({
	label,
	value,
	onChange,
	placeholder,
	widthClass = 'w-44',
	mono = false,
	type = 'text',
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	widthClass?: string;
	mono?: boolean;
	type?: 'text' | 'search';
}) {
	return (
		<label className="flex min-w-0 max-w-full items-center gap-2">
			<span className={LABEL_CLASS}>{label}</span>
			<div className={`min-w-0 ${PILL_CLASS}`}>
				<input
					type={type}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					autoComplete="off"
					className={`block h-6 ${widthClass} min-w-0 rounded-md px-2.5 text-xs outline-none transition placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-blue-500 ${
						mono ? 'font-mono ' : ''
					}${value ? 'bg-white text-slate-800 shadow-sm' : 'bg-transparent text-slate-700'}`}
				/>
			</div>
		</label>
	);
}
