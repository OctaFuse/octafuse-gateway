'use client';

import { useTranslations } from 'next-intl';
import { isLossPricing, type PriceTripleDraft } from './provider-card-state';

export function ToolPriceTripleInputs({
	value,
	onChange,
	step = 0.0001,
}: {
	value: PriceTripleDraft;
	onChange: (patch: Partial<PriceTripleDraft>) => void;
	step?: number | 'any';
}) {
	const t = useTranslations('tools');
	/** 展示顺序：标准价 → 用户扣费 → 供应价（与 Routes 语义对齐，运营先看目录/扣费） */
	const fields: Array<{
		key: 'standard' | 'charged' | 'metered';
		labelKey: 'unitPrices.standard' | 'unitPrices.charged' | 'unitPrices.metered';
	}> = [
		{ key: 'standard', labelKey: 'unitPrices.standard' },
		{ key: 'charged', labelKey: 'unitPrices.charged' },
		{ key: 'metered', labelKey: 'unitPrices.metered' },
	];
	const loss = isLossPricing(value);
	return (
		<div
			className={
				loss
					? 'rounded-md border border-amber-400 bg-amber-50/80 p-2 ring-1 ring-amber-300'
					: 'rounded-md border border-transparent p-2'
			}
		>
			<div className="flex flex-col gap-1.5">
				{fields.map(({ key, labelKey }) => {
					const highlightCharged = loss && key === 'charged';
					const highlightMetered = loss && key === 'metered';
					return (
						<label key={key} className="flex items-center gap-1.5">
							<span
								className={
									highlightCharged || highlightMetered
										? 'w-[4.5rem] shrink-0 text-[10px] font-semibold text-amber-800'
										: 'w-[4.5rem] shrink-0 text-[10px] font-semibold text-gray-500'
								}
							>
								{t(labelKey)}
							</span>
							<input
								type="number"
								min={0}
								step={step}
								value={value[key]}
								onChange={(e) => onChange({ [key]: e.target.value })}
								className={
									highlightCharged
										? 'w-full max-w-[7rem] rounded-md border border-amber-500 bg-white px-2 py-1 font-mono text-sm text-amber-950 shadow-sm'
										: 'w-full max-w-[7rem] rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-sm shadow-sm'
								}
							/>
						</label>
					);
				})}
			</div>
			{loss ? (
				<p className="mt-1.5 text-[10px] font-medium leading-snug text-amber-800">
					{t('unitPrices.lossHint')}
				</p>
			) : null}
		</div>
	);
}
