'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resolveToolFactorPrices } from '@octafuse/core/lib/tool-pricing';
import { formatGatewayMoneyCompact, getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { toolPricingFromDraft, type ToolPricingDraft } from '@/lib/tool-pricing-draft';

/** One editor for service defaults and whole-rule tool overrides. */
export function ToolPricingEditor({
	value,
	currency,
	unitLabel = 'request',
	onChange,
}: {
	value: ToolPricingDraft;
	currency: string;
	unitLabel?: string;
	onChange: (value: ToolPricingDraft) => void;
}) {
	const t = useTranslations('toolPricing');
	const [paidSelected, setPaidSelected] = useState(() => value.chargedFactor !== '0');
	const lastFactor = useRef(Number(value.chargedFactor) > 0 ? value.chargedFactor : '1');
	const free = !paidSelected && Number(value.chargedFactor) === 0;
	const parsed = toolPricingFromDraft(value);
	const prices = parsed.ok ? resolveToolFactorPrices(parsed.pricing) : null;
	function choose(paid: boolean) {
		if (Number(value.chargedFactor) > 0) lastFactor.current = value.chargedFactor;
		setPaidSelected(paid);
		onChange({ ...value, chargedFactor: paid ? lastFactor.current : '0' });
	}
	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t('simpleTitle')}>
				{(['free', 'perCall'] as const).map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={free === (option === 'free')}
						onClick={() => choose(option === 'perCall')}
						className={`rounded-xl border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							free === (option === 'free')
								? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
								: 'border-gray-200 bg-white hover:border-gray-400'
						}`}
					>
						<span className="block text-sm font-semibold text-gray-900">
							{t(option === 'free' ? 'freeMode' : unitLabel === 'request' ? 'perCallMode' : 'perUnitMode')}
						</span>
						<span className="mt-1 block text-xs leading-5 text-gray-500">
							{t(option === 'free' ? 'freeHint' : 'perCallHint')}
						</span>
					</button>
				))}
			</div>
			{value.legacyNeedsReview ? (
				<p role="status" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
					{t('legacyNeedsReview')}
				</p>
			) : null}
			<div className="grid gap-4 sm:grid-cols-3">
				{(['standard', 'chargedFactor', 'meteredFactor'] as const).map((key) => (
					<label key={key} className="block text-sm font-medium text-gray-700">
						{t(key, { currency: getGatewayCurrencySymbol(currency), unit: unitLabel })}
						<input
							type="number"
							min={0}
							step="any"
							required
							data-pricing-field={key}
							readOnly={free && key === 'chargedFactor'}
							value={value[key]}
							onChange={(event) => onChange({ ...value, [key]: event.target.value })}
							className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-gray-100 read-only:text-gray-500"
						/>
						<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-500">
							{t(`${key}Hint`)}
						</span>
					</label>
				))}
			</div>
			<div className="rounded-xl border border-gray-200 bg-gray-50 p-4" role="status" aria-live="polite">
				<dl className="grid gap-4 sm:grid-cols-2">
					{(['charged', 'metered'] as const).map((key) => (
						<div key={key}>
							<dt className="text-xs text-gray-500">{t(`${key}Result`)}</dt>
							<dd className="mt-1 font-mono text-base font-semibold text-gray-900">
								{prices ? `${formatGatewayMoneyCompact(prices[key], currency)} / ${unitLabel}` : '—'}
							</dd>
							<p className="mt-1 text-xs text-gray-500">{t(`${key}Formula`)}</p>
						</div>
					))}
				</dl>
			</div>
		</div>
	);
}
