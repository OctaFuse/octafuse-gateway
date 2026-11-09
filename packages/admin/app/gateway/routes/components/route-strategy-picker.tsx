'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RouteStrategyName } from '@octafuse/core';
import { ROUTE_STRATEGY_META_LIST } from '../route-strategy-meta';
import { RouteStrategyDiagram } from './route-strategy-diagram';

export type RouteStrategyPickerProps = {
	/** Currently selected strategy id, or '' for inherit. */
	value: string;
	onChange: (value: string) => void;
	/** When set, empty selection highlights the inherited strategy. */
	allowInherit?: boolean;
	inheritedStrategy?: string;
	/** @deprecated Kept for call-site compatibility; no longer shown in the picker. */
	inheritedSourceLabel?: string;
	disabled?: boolean;
	className?: string;
	/** Compact density for Config page. */
	dense?: boolean;
};

function strategyTitleKey(id: RouteStrategyName): `display.${RouteStrategyName}` {
	return `display.${id}`;
}

export function RouteStrategyPicker(props: RouteStrategyPickerProps) {
	const {
		value,
		onChange,
		allowInherit = false,
		inheritedStrategy,
		disabled = false,
		className,
		dense = false,
	} = props;
	const t = useTranslations('routes.strategy');
	const groupId = useId();
	const [hovered, setHovered] = useState<string | null>(null);

	const effective =
		value || (allowInherit && inheritedStrategy ? inheritedStrategy : value);

	const selectStrategy = (next: string) => {
		if (disabled) return;
		// With inherit enabled, clicking the active override again clears back to inherit.
		if (allowInherit && value && next === value) {
			onChange('');
			return;
		}
		onChange(next);
	};

	return (
		<div className={className}>
			<div
				role="radiogroup"
				aria-labelledby={`${groupId}-label`}
				className="grid gap-3 sm:grid-cols-2"
			>
				<span id={`${groupId}-label`} className="sr-only">
					{t('guideTitle')}
				</span>
				{ROUTE_STRATEGY_META_LIST.map((meta) => {
					const selected = effective === meta.id;
					const showMotion = selected || hovered === meta.id;
					return (
						<button
							key={meta.id}
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={disabled}
							onClick={() => selectStrategy(meta.id)}
							onMouseEnter={() => setHovered(meta.id)}
							onMouseLeave={() => setHovered((cur) => (cur === meta.id ? null : cur))}
							onFocus={() => setHovered(meta.id)}
							onBlur={() => setHovered((cur) => (cur === meta.id ? null : cur))}
							className={`flex h-full flex-col items-stretch justify-start rounded-lg border p-3.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50 ${
								selected
									? 'border-gray-300 bg-gray-50/70 ring-1 ring-inset ring-gray-200'
									: 'border-gray-200 bg-white hover:border-gray-200 hover:bg-slate-50'
							}`}
						>
							<div>
								<div className="truncate text-sm font-medium leading-5 text-gray-900">
									{t(strategyTitleKey(meta.id))}
								</div>
								<div className="mt-0.5 truncate font-mono text-xs leading-4 text-gray-400">
									{meta.machineId}
								</div>
							</div>

							<div className="mt-2.5">
								<RouteStrategyDiagram
									kind={meta.diagram}
									active={showMotion}
									caption={t(`diagramCaption.${meta.id}`)}
								/>
							</div>

							<p className={`mt-2 leading-relaxed text-gray-600 ${dense ? 'text-xs' : 'text-xs'}`}>
								{t(`description.${meta.id}.summary`)}
							</p>
							<p className="mt-1 text-xs leading-relaxed text-gray-500">
								<span className="font-medium text-gray-600">{t('bestFor')}</span>
								{t('labelSeparator')}
								{t(`description.${meta.id}.bestFor`)}
							</p>
							<p className="mt-0.5 text-xs leading-relaxed text-gray-500">
								<span className="font-medium text-gray-600">{t('tradeoff')}</span>
								{t('labelSeparator')}
								{t(`description.${meta.id}.tradeoff`)}
							</p>
						</button>
					);
				})}
			</div>
		</div>
	);
}
