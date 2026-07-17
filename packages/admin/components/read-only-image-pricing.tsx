'use client';

import { useState } from 'react';
import type { CatalogImagePricingDisplay } from '@/lib/pricing-ui';

const TOKEN_RATE_ROWS = [
	{ key: 'textInput', label: 'Text Input', shortLabel: 'text' },
	{ key: 'cachedText', label: 'Cached Text', shortLabel: 'cached text' },
	{ key: 'imageInput', label: 'Image Input', shortLabel: 'img-in' },
	{ key: 'cachedImageInput', label: 'Cached Image Input', shortLabel: 'cached img-in' },
	{ key: 'imageOutput', label: 'Image Output', shortLabel: 'img-out' },
] as const;

type TokenRateKey = (typeof TOKEN_RATE_ROWS)[number]['key'];

type Props = {
	display: CatalogImagePricingDisplay | null;
	emptyLabel: string;
	tableTitle: string;
	/** 命中顺序说明；`compact` 时默认不展示 */
	resolveHint?: string;
	/** token 分项价块标题 */
	tokenRatesTitle?: string;
	/** 估算矩阵说明 */
	estimateMatrixHint?: string;
	/**
	 * Models 卡片等紧凑场景：省略 resolve 文案。
	 */
	compact?: boolean;
	/** 是否展示 token 分项（路由 / 只读目录） */
	showTokenRates?: boolean;
	/** token 分项布局：`grid` 横向密排；`list` 纵向列表 */
	tokenRatesLayout?: 'grid' | 'list';
	/** 是否展示 quality×size 估算矩阵（可折叠） */
	showMatrix?: boolean;
	/** 估算矩阵是否默认展开；默认折叠 */
	matrixDefaultExpanded?: boolean;
	/** 展开按钮文案（折叠态） */
	expandLabel?: string;
	/** 收起按钮文案（展开态） */
	collapseLabel?: string;
	/** @deprecated unused — kept for call-site compatibility */
	fallbackTitle?: string;
};

/** 路由弹窗 / Models 卡片：Image token 价与可折叠输出侧估算矩阵（只读，非扣费） */
export function ReadOnlyImagePricing(props: Props) {
	const {
		display,
		emptyLabel,
		tableTitle,
		resolveHint,
		tokenRatesTitle,
		estimateMatrixHint,
		compact = false,
		showTokenRates = true,
		tokenRatesLayout = 'list',
		showMatrix = true,
		matrixDefaultExpanded = false,
		expandLabel,
		collapseLabel,
	} = props;
	const [matrixExpanded, setMatrixExpanded] = useState(matrixDefaultExpanded);

	if (!display) {
		return <p className="text-sm text-gray-500">{emptyLabel}</p>;
	}

	const hasMatrix = showMatrix && display.matrix != null;
	const toggleLabel = matrixExpanded
		? (collapseLabel ?? tableTitle)
		: (expandLabel ?? tableTitle);
	const rates = display.tokenRates;

	return (
		<div className="space-y-2">
			{!compact && resolveHint ? (
				<p className="text-[11px] text-gray-500 leading-relaxed">{resolveHint}</p>
			) : null}

			{showTokenRates ? (
				tokenRatesLayout === 'grid' ? (
					<div>
						<p className="mb-1.5 text-[11px] font-medium text-gray-600">
							{tokenRatesTitle ?? 'Image token rates'}
							<span className="ml-1 font-normal text-gray-400">({rates.unit})</span>
						</p>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
							{TOKEN_RATE_ROWS.map((row) => (
								<div
									key={row.key}
									className="rounded-md border border-gray-100 bg-gray-50/70 px-2.5 py-2"
									title={`${row.label} (${rates.unit})`}
								>
									<p className="truncate text-[11px] font-medium text-gray-500">{row.label}</p>
									<p className="mt-1 text-sm font-semibold tabular-nums text-gray-900">
										{rates[row.key as TokenRateKey]}
									</p>
								</div>
							))}
						</div>
					</div>
				) : (
					<div className="overflow-hidden rounded-md border border-gray-200 bg-white">
						<p className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-600">
							{tokenRatesTitle ?? 'Image token rates'}
							<span className="ml-1 font-normal text-gray-400">({rates.unit})</span>
						</p>
						<ul className="divide-y divide-gray-100 text-sm tabular-nums">
							{TOKEN_RATE_ROWS.map((row) => (
								<li
									key={row.key}
									className="flex items-baseline justify-between gap-3 px-3 py-2"
								>
									<span className="text-xs text-gray-500" title={row.shortLabel}>
										{row.label}
									</span>
									<span className="font-medium text-gray-900">
										{rates[row.key as TokenRateKey]}
									</span>
								</li>
							))}
						</ul>
					</div>
				)
			) : null}

			{hasMatrix ? (
				<div className="overflow-hidden rounded-md border border-gray-200 bg-white">
					<button
						type="button"
						aria-expanded={matrixExpanded}
						onClick={(e) => {
							e.stopPropagation();
							setMatrixExpanded((v) => !v);
						}}
						className="flex w-full items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-left text-[11px] font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
					>
						<span>{toggleLabel}</span>
						<span className="shrink-0 text-gray-400" aria-hidden>
							{matrixExpanded ? '▾' : '▸'}
						</span>
					</button>
					{matrixExpanded ? (
						<>
							{estimateMatrixHint ? (
								<p className="border-b border-gray-100 px-3 py-1.5 text-[11px] text-gray-500 leading-relaxed">
									{estimateMatrixHint}
								</p>
							) : null}
							<div className="overflow-x-auto">
								<table className="min-w-full text-xs tabular-nums">
									<thead>
										<tr className="border-b border-gray-100 bg-gray-50/80">
											<th className="px-2 py-1.5 text-left font-medium text-gray-500">
												quality \\ size
											</th>
											{display.matrix!.sizes.map((s) => (
												<th
													key={s}
													className="px-2 py-1.5 text-right font-mono font-medium text-gray-500"
												>
													{s}
												</th>
											))}
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-100">
										{display.matrix!.qualities.map((q) => (
											<tr key={q}>
												<td className="px-2 py-1.5 font-mono text-gray-600">{q}</td>
												{display.matrix!.sizes.map((s) => {
													const price = display.matrix!.cells[q]?.[s];
													return (
														<td key={s} className="px-2 py-1.5 text-right text-gray-900">
															{price != null ? (
																<span title={`${q}:${s}`}>
																	{price}{' '}
																	<span className="text-[10px] text-gray-400">
																		{display.unit}
																	</span>
																</span>
															) : (
																<span className="text-gray-300">—</span>
															)}
														</td>
													);
												})}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</>
					) : null}
				</div>
			) : null}
		</div>
	);
}
