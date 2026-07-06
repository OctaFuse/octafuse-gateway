'use client';

import {
	parseChargedFactorFromPriceOverride,
	parseMeteredFactorFromPriceOverride,
} from '@/lib/pricing-ui';
import {
	chargedFactorTooltip,
	factorChipClassForValue,
	formatFactorMultiplier,
	formatFactorMultiplierForChip,
	meteredFactorTooltip,
} from '../route-utils';
import { FACTOR_CHIP_BASE } from '../types';
import type { RouteListRow } from '../types';

type Props = {
	route: RouteListRow;
	togglingId: string | null;
	onEdit: (route: RouteListRow) => void;
	onToggleStatus: (route: RouteListRow) => void;
};

export function RouteListItem(props: Props) {
	const { route, togglingId, onEdit, onToggleStatus } = props;
	const chargedF = parseChargedFactorFromPriceOverride(route.price_override);
	const meteredF = parseMeteredFactorFromPriceOverride(route.price_override);
	const chargedDisp = chargedF != null && Number.isFinite(chargedF) ? chargedF : null;
	const meteredDisp = meteredF != null && Number.isFinite(meteredF) ? meteredF : null;

	return (
		<li className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-gray-50/80">
			<div className="shrink-0 pt-0.5">
				<input
					type="checkbox"
					checked={route.status === 'active'}
					disabled={togglingId === route.id}
					onChange={() => onToggleStatus(route)}
					className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
					aria-label={
						route.status === 'active'
							? 'Route enabled (uncheck to disable)'
							: 'Route disabled (check to enable)'
					}
				/>
			</div>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<button
					type="button"
					onClick={() => onEdit(route)}
					className="-mx-1 min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-gray-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
				>
					<div className="flex min-w-0 flex-col gap-0.5 text-xs leading-snug">
						<div className="flex min-w-0 items-center gap-2">
							<div className="flex shrink-0 items-center" title="Priority (failover order)">
								<span className="text-[11px] font-semibold tabular-nums text-gray-600">
									{route.priority}
								</span>
							</div>
							<span
								className="min-w-0 flex-1 truncate font-medium text-gray-900"
								title={route.provider_name || route.provider_id}
							>
								{route.provider_name || route.provider_id}
							</span>
						</div>
						<div
							className="min-w-0 truncate text-left font-mono text-[11px] text-gray-600"
							title={route.provider_model_name}
						>
							{route.provider_model_name}
						</div>
					</div>
				</button>
				<div
					className="flex shrink-0 flex-col items-end justify-start gap-1.5 self-stretch pt-0.5 text-right"
					role="group"
					aria-label="Charged and metered catalog factors"
				>
					<span
						className={
							chargedDisp != null
								? factorChipClassForValue(chargedDisp)
								: `${FACTOR_CHIP_BASE} bg-zinc-50 text-zinc-400 ring-zinc-200/90`
						}
						title={chargedFactorTooltip(chargedDisp)}
						aria-label={
							chargedDisp != null
								? `Charged factor ${formatFactorMultiplier(chargedDisp)}`
								: 'Charged factor not set'
						}
					>
						{chargedDisp != null ? formatFactorMultiplierForChip(chargedDisp) : '—'}
					</span>
					<span
						className={
							meteredDisp != null
								? factorChipClassForValue(meteredDisp)
								: `${FACTOR_CHIP_BASE} bg-zinc-50 text-zinc-400 ring-zinc-200/90`
						}
						title={meteredFactorTooltip(meteredDisp)}
						aria-label={
							meteredDisp != null
								? `Metered factor ${formatFactorMultiplier(meteredDisp)}`
								: 'Metered factor not set'
						}
					>
						{meteredDisp != null ? formatFactorMultiplierForChip(meteredDisp) : '—'}
					</span>
				</div>
			</div>
		</li>
	);
}
