'use client';

/** 请求详情里模型请求流程与工具调用详情共用的展示块：字段网格、可复制的原始数据、金额卡片。 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MultiplierBadge } from '@/components/financial-value';
import { PricingInfoHint } from '@/components/PricingInfoHint';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned } from '@/lib/format-gateway-currency';
import type { GatewayRequestLog } from '@/lib/types';

export const detailButtonClass =
	'rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:border-gray-300 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-500';

export type DetailFieldRow = [string, unknown, 'factor'?];

export function Fields({ rows }: { rows: DetailFieldRow[] }) {
	return (
		<dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
			{rows.map(([label, value, kind]) => (
				<div key={label} className="min-w-0">
					<dt className="text-xs text-gray-500">{label}</dt>
					<dd className="mt-1 break-words font-mono text-xs text-gray-800 [overflow-wrap:anywhere]">
						{value == null || value === '' ? (
							'—'
						) : kind === 'factor' && value !== '—' ? (
							<MultiplierBadge title={label}>{String(value)}</MultiplierBadge>
						) : (
							String(value)
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}

export function RawData({
	title,
	raw,
	collapsible = true,
}: {
	title: string;
	raw: string | null | undefined;
	collapsible?: boolean;
}) {
	const common = useTranslations('common');
	const t = useTranslations('requestLogs.flow');
	const [copiedText, setCopiedText] = useState<string | null>(null);
	const [copyFailed, setCopyFailed] = useState(false);
	let display = raw?.trim() ?? '';
	try {
		if (display) display = JSON.stringify(JSON.parse(display), null, 2);
	} catch {
		/* Keep malformed legacy values readable. */
	}
	const content = (
		<div className="p-3">
			<div className="mb-2 flex justify-end gap-2">
				{copyFailed && (
					<span role="status" className="text-xs text-red-600">
						{t('copyFailed')}
					</span>
				)}
				<button
					type="button"
					className={detailButtonClass}
					aria-label={`${title} · ${copiedText === display ? common('copied') : common('copy')}`}
					disabled={!display}
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(display);
							setCopiedText(display);
							setCopyFailed(false);
						} catch {
							setCopiedText(null);
							setCopyFailed(true);
						}
					}}
				>
					{copiedText === display ? common('copied') : common('copy')}
				</button>
			</div>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 font-mono text-xs leading-relaxed text-gray-700">
				{display || common('noDataFound')}
			</pre>
		</div>
	);
	return collapsible ? (
		<details className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
			<summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
				{title}
			</summary>
			<div className="border-t border-gray-100">{content}</div>
		</details>
	) : (
		<div
			role="group"
			aria-label={title}
			className="overflow-hidden rounded-lg border border-gray-200 bg-white"
		>
			{content}
		</div>
	);
}

/** 计费、成本、目录金额与毛利：该请求的记账快照。 */
export function CostCards({ log, currency }: { log: GatewayRequestLog; currency: string }) {
	const t = useTranslations('requestLogs');
	const f = useTranslations('requestLogs.flow');
	const profit = (log.charged_cost ?? 0) - (log.metered_cost ?? 0);
	const amounts: [string, number | undefined][] = [
		[t('titles.chargedUserBudget'), log.charged_cost],
		[t('titles.meteredSupplierCost'), log.metered_cost],
		[f('catalogAmount'), log.standard_cost],
	];
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{amounts.map(([label, amount]) => (
				<div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
					<div className="text-xs text-gray-500">{label}</div>
					<div className="mt-1 font-mono text-base font-medium text-gray-800">
						{amount == null ? '—' : formatGatewayMoneyCode(amount, currency, 6)}
					</div>
				</div>
			))}
			<div className="rounded-lg border border-gray-200 bg-white p-3">
				<div className="flex items-center gap-1 text-xs text-gray-500">
					{t('ui.profit')}
					<PricingInfoHint kind="profit" />
				</div>
				<div
					className={`mt-1 text-base font-medium tabular-nums ${profit < 0 ? 'text-red-600' : 'text-gray-900'}`}
				>
					{formatGatewayMoneyCodeSigned(profit, currency, 6)}
				</div>
			</div>
		</div>
	);
}
