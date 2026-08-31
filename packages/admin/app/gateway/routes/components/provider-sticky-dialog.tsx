'use client';

import {
	DEFAULT_STICKY_IDLE_TTL_SECONDS,
	MAX_STICKY_IDLE_TTL_SECONDS,
	MIN_STICKY_IDLE_TTL_SECONDS,
} from '@octafuse/core/db/route-pool-sticky-types';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/feedback';
import {
	clearStickyBinding,
	fetchStickyBindingsSummary,
	lookupStickyBinding,
	resetStickyBindings,
} from '../route-api';
import { useStickyRefreshControls } from '../sticky-summary-store';
import type {
	ProviderStickyDialogState,
	ProviderStickyFormState,
	StickyBindingLookup,
	StickyBindingsSummary,
} from '../types';

type Props = {
	dialog: ProviderStickyDialogState;
	form: ProviderStickyFormState;
	error: string;
	saving: boolean;
	onClose: () => void;
	onFormChange: (form: ProviderStickyFormState) => void;
	onSave: () => void;
	onBindingsChanged?: () => void;
};

function looksLikeEmail(value: string): boolean {
	return value.includes('@');
}

export function ProviderStickyDialog(props: Props) {
	const { dialog, form, error, saving, onClose, onFormChange, onSave, onBindingsChanged } = props;
	const t = useTranslations('routes.providerSticky');
	const tCommon = useTranslations('common');
	const { confirm } = useFeedback();
	const { invalidate } = useStickyRefreshControls();
	const canSave = Boolean(dialog.poolId);
	const ttlOutOfRange =
		!Number.isFinite(form.idleTtlSeconds) ||
		form.idleTtlSeconds < MIN_STICKY_IDLE_TTL_SECONDS ||
		form.idleTtlSeconds > MAX_STICKY_IDLE_TTL_SECONDS;

	const [summary, setSummary] = useState<StickyBindingsSummary | null>(null);
	const [summaryLoading, setSummaryLoading] = useState(false);
	const [summaryError, setSummaryError] = useState('');
	const [userQuery, setUserQuery] = useState('');
	const [lookupLoading, setLookupLoading] = useState(false);
	const [lookupError, setLookupError] = useState('');
	const [lookup, setLookup] = useState<StickyBindingLookup | null>(null);
	const [actionBusy, setActionBusy] = useState(false);
	const [actionMessage, setActionMessage] = useState('');
	/** When sticky is off but leftovers exist, ops panels stay collapsed until expanded. */
	const [opsExpanded, setOpsExpanded] = useState(false);

	const residualCount = summary
		? summary.total_active + summary.stale_count
		: 0;
	const hasResidual = residualCount > 0;
	const showFullOps = Boolean(dialog.poolId) && (form.enabled || (hasResidual && opsExpanded));
	// Quiet fetch when off+empty; only surface a banner once leftovers (or an error) are known.
	const showResidualBanner =
		Boolean(dialog.poolId) &&
		!form.enabled &&
		(hasResidual || Boolean(summaryError));

	const targetMeta = useMemo(() => {
		const map = new Map(dialog.targets.map((row) => [row.id, row]));
		return map;
	}, [dialog.targets]);

	const totalWeight = useMemo(
		() => dialog.targets.reduce((sum, row) => sum + Math.max(1, row.weight), 0),
		[dialog.targets]
	);

	const refreshSummary = useCallback(async () => {
		if (!dialog.poolId) {
			setSummary(null);
			return;
		}
		setSummaryLoading(true);
		setSummaryError('');
		try {
			const result = await fetchStickyBindingsSummary(dialog.poolId);
			if (!result.success) {
				setSummaryError(result.message);
				setSummary(null);
				return;
			}
			setSummary(result.data);
		} finally {
			setSummaryLoading(false);
		}
	}, [dialog.poolId]);

	useEffect(() => {
		void refreshSummary();
	}, [refreshSummary]);

	// Enabling sticky always shows ops; turning off collapses them again.
	useEffect(() => {
		if (form.enabled) setOpsExpanded(false);
	}, [form.enabled]);

	const handleLookup = async () => {
		if (!dialog.poolId) return;
		const q = userQuery.trim();
		if (!q) {
			setLookupError(t('lookupRequired'));
			return;
		}
		setLookupLoading(true);
		setLookupError('');
		setLookup(null);
		setActionMessage('');
		try {
			const result = await lookupStickyBinding({
				poolId: dialog.poolId,
				modelId: dialog.modelId,
				routeGroup: dialog.group,
				protocol: dialog.protocol,
				requestOperation: dialog.requestOperation,
				...(looksLikeEmail(q) ? { email: q } : { userId: q }),
			});
			if (!result.success) {
				setLookupError(result.message);
				return;
			}
			setLookup(result.data);
		} finally {
			setLookupLoading(false);
		}
	};

	const handleClearLookup = async () => {
		if (!dialog.poolId || !lookup?.affinity_hash) return;
		const ok = await confirm({
			title: t('clearBinding'),
			message: t('clearConfirm'),
			danger: true,
		});
		if (!ok) return;
		setActionBusy(true);
		setActionMessage('');
		try {
			const result = await clearStickyBinding(dialog.poolId, lookup.affinity_hash);
			if (!result.success) {
				setActionMessage(result.message);
				return;
			}
			setActionMessage(result.cleared ? t('clearDone') : t('clearMiss'));
			setLookup((prev) => (prev ? { ...prev, binding: null } : prev));
			await refreshSummary();
			await invalidate(dialog.poolId);
			onBindingsChanged?.();
		} finally {
			setActionBusy(false);
		}
	};

	const handleResetPool = async () => {
		if (!dialog.poolId) return;
		const ok = await confirm({
			title: t('resetTitle'),
			message: t('resetConfirm'),
			danger: true,
		});
		if (!ok) return;
		setActionBusy(true);
		setActionMessage('');
		try {
			const result = await resetStickyBindings(dialog.poolId);
			if (!result.success) {
				setActionMessage(result.message);
				return;
			}
			setActionMessage(t('resetDone', { epoch: result.sticky_epoch }));
			setLookup((prev) => (prev ? { ...prev, binding: null } : prev));
			await refreshSummary();
			await invalidate(dialog.poolId);
			onBindingsChanged?.();
		} finally {
			setActionBusy(false);
		}
	};

	const distributionRows = useMemo(() => {
		const counts = new Map(
			(summary?.targets ?? []).map((row) => [row.route_target_id, row])
		);
		const ids = new Set<string>([
			...dialog.targets.map((row) => row.id),
			...(summary?.targets ?? []).map((row) => row.route_target_id),
		]);
		return [...ids]
			.map((id) => {
				const meta = targetMeta.get(id);
				const countRow = counts.get(id);
				const weight = meta ? Math.max(1, meta.weight) : 0;
				const weightShare = totalWeight > 0 && weight > 0 ? weight / totalWeight : 0;
				return {
					id,
					providerName: meta?.providerName ?? id,
					priority: meta?.priority ?? null,
					weight,
					weightShare,
					activeCount: countRow?.active_count ?? 0,
					bindingShare: countRow?.share ?? 0,
				};
			})
			.sort((a, b) => b.activeCount - a.activeCount || (b.priority ?? 0) - (a.priority ?? 0));
	}, [dialog.targets, summary, targetMeta, totalWeight]);

	const lookupTargetLabel = lookup?.binding
		? targetMeta.get(lookup.binding.route_target_id)?.providerName ??
			lookup.binding.route_target_id
		: null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !saving && !actionBusy) onClose();
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-sticky-dialog-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
					<div>
						<h2
							id="provider-sticky-dialog-title"
							className="text-base font-semibold text-gray-900"
						>
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">{dialog.requestOperation}</span> ·{' '}
							<span className="font-mono">{dialog.group}</span>
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={saving || actionBusy}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
					{error ? (
						<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{error}
						</div>
					) : null}

					{!dialog.poolId ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
							{t('requiresPool')}
						</div>
					) : null}

					<label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3.5 py-3">
						<input
							type="checkbox"
							checked={form.enabled}
							disabled={saving || !canSave}
							onChange={(event) =>
								onFormChange({ ...form, enabled: event.target.checked })
							}
							className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
						/>
						<span className="min-w-0">
							<span className="block text-sm font-medium text-gray-900">{t('enable')}</span>
							<span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
								{t('scopeHint')}
							</span>
						</span>
					</label>

					<div>
						<label
							htmlFor="provider-sticky-idle-ttl"
							className="mb-1 block text-sm font-medium text-gray-700"
						>
							{t('idleTtl')}
						</label>
						<input
							id="provider-sticky-idle-ttl"
							type="number"
							min={MIN_STICKY_IDLE_TTL_SECONDS}
							max={MAX_STICKY_IDLE_TTL_SECONDS}
							step={1}
							value={form.idleTtlSeconds}
							disabled={saving || !canSave}
							onChange={(event) => {
								const next = Number(event.target.value);
								onFormChange({
									...form,
									idleTtlSeconds: Number.isFinite(next)
										? Math.round(next)
										: form.idleTtlSeconds,
								});
							}}
							className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-50"
						/>
						<p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
							{t('idleTtlHint', {
								min: MIN_STICKY_IDLE_TTL_SECONDS,
								max: MAX_STICKY_IDLE_TTL_SECONDS,
								default: DEFAULT_STICKY_IDLE_TTL_SECONDS,
							})}
						</p>
					</div>

					<div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5">
						<h3 className="text-sm font-semibold text-gray-900">{t('effectTitle')}</h3>
						<p className="mt-2 text-xs leading-relaxed text-gray-700">{t('orderPreview')}</p>
						<p className="mt-2 text-[11px] leading-relaxed text-amber-800">{t('tradeoff')}</p>
						<p className="mt-2 text-[11px] leading-relaxed text-gray-500">{t('poolSharedHint')}</p>
					</div>

					{showResidualBanner ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">
							{summaryError && !hasResidual ? (
								<p className="text-xs text-red-600">{summaryError}</p>
							) : (
								<>
									<p className="text-sm font-medium text-amber-900">{t('residualTitle')}</p>
									<p className="mt-1 text-[11px] leading-relaxed text-amber-800">
										{t('residualHint', {
											active: summary?.total_active ?? 0,
											stale: summary?.stale_count ?? 0,
										})}
									</p>
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											type="button"
											onClick={() => void handleResetPool()}
											disabled={actionBusy || saving}
											className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
										>
											{t('resetButton')}
										</button>
										<button
											type="button"
											onClick={() => setOpsExpanded((v) => !v)}
											disabled={actionBusy}
											className="rounded-md border border-amber-200 bg-transparent px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100/70 disabled:opacity-50"
										>
											{opsExpanded ? t('hideOps') : t('showOps')}
										</button>
									</div>
								</>
							)}
						</div>
					) : null}

					{showFullOps ? (
						<>
							<div className="rounded-lg border border-gray-200 p-3.5">
								<div className="flex items-center justify-between gap-2">
									<h3 className="text-sm font-semibold text-gray-900">
										{t('distributionTitle')}
									</h3>
									<button
										type="button"
										onClick={() => void refreshSummary()}
										disabled={summaryLoading || actionBusy}
										className="rounded-md px-2 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
									>
										{summaryLoading ? tCommon('loadingEllipsis') : t('refresh')}
									</button>
								</div>
								<p className="mt-1 text-[11px] leading-relaxed text-gray-500">
									{t('distributionHint')}
								</p>
								{summaryError ? (
									<p className="mt-2 text-xs text-red-600">{summaryError}</p>
								) : null}
								{summary ? (
									<p className="mt-2 text-xs text-gray-600">
										{t('distributionTotals', {
											active: summary.total_active,
											stale: summary.stale_count,
										})}
									</p>
								) : null}
								<div className="mt-3 space-y-2">
									{distributionRows.length === 0 ? (
										<p className="text-xs text-gray-500">{t('distributionEmpty')}</p>
									) : (
										distributionRows.map((row) => (
											<div
												key={row.id}
												className="rounded-md border border-gray-100 bg-gray-50/70 px-3 py-2"
											>
												<div className="flex items-center justify-between gap-2 text-xs">
													<span className="min-w-0 truncate font-medium text-gray-800">
														{row.providerName}
														{row.priority != null ? (
															<span className="ml-1 font-mono text-[10px] text-gray-500">
																P{row.priority}
															</span>
														) : null}
													</span>
													<span className="shrink-0 font-mono text-gray-700">
														{row.activeCount}
													</span>
												</div>
												<div className="mt-1.5 grid grid-cols-2 gap-2">
													<div>
														<div className="mb-0.5 flex justify-between text-[10px] text-gray-500">
															<span>{t('bindingShare')}</span>
															<span>{Math.round(row.bindingShare * 100)}%</span>
														</div>
														<div className="h-1.5 overflow-hidden rounded bg-gray-200">
															<div
																className="h-full rounded bg-emerald-500"
																style={{
																	width: `${Math.round(row.bindingShare * 100)}%`,
																}}
															/>
														</div>
													</div>
													<div>
														<div className="mb-0.5 flex justify-between gap-1 text-[10px] text-gray-500">
															<span>{t('weightShare')}</span>
															<span className="shrink-0 font-mono">
																{row.weight > 0
																	? t('weightShareValue', {
																			weight: row.weight,
																			pct: Math.round(row.weightShare * 100),
																		})
																	: '—'}
															</span>
														</div>
														<div className="h-1.5 overflow-hidden rounded bg-gray-200">
															<div
																className="h-full rounded bg-slate-400"
																style={{
																	width: `${Math.round(row.weightShare * 100)}%`,
																}}
															/>
														</div>
													</div>
												</div>
											</div>
										))
									)}
								</div>
							</div>

							<div className="rounded-lg border border-gray-200 p-3.5">
								<h3 className="text-sm font-semibold text-gray-900">{t('lookupTitle')}</h3>
								<p className="mt-1 text-[11px] leading-relaxed text-gray-500">
									{t('lookupHint')}
								</p>
								<div className="mt-3 flex gap-2">
									<input
										type="text"
										value={userQuery}
										onChange={(event) => setUserQuery(event.target.value)}
										placeholder={t('lookupPlaceholder')}
										disabled={lookupLoading || actionBusy}
										className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50"
										onKeyDown={(event) => {
											if (event.key === 'Enter') {
												event.preventDefault();
												void handleLookup();
											}
										}}
									/>
									<button
										type="button"
										onClick={() => void handleLookup()}
										disabled={lookupLoading || actionBusy}
										className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
									>
										{lookupLoading ? tCommon('loadingEllipsis') : t('lookup')}
									</button>
								</div>
								{lookupError ? (
									<p className="mt-2 text-xs text-red-600">{lookupError}</p>
								) : null}
								{lookup ? (
									<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700">
										<p>
											<span className="font-medium">{t('lookupUser')}</span>{' '}
											<span className="font-mono">{lookup.user_id}</span>
										</p>
										{lookup.binding ? (
											<>
												<p className="mt-1">
													<span className="font-medium">{t('lookupTarget')}</span>{' '}
													{lookupTargetLabel}
												</p>
												<p className="mt-1">
													{t('lookupTtl', {
														seconds: lookup.binding.remaining_seconds,
													})}
													{' · '}
													{lookup.binding.epoch_valid
														? t('lookupEpochValid')
														: t('lookupEpochInvalid')}
													{lookup.binding.expired ? ` · ${t('lookupExpired')}` : ''}
												</p>
												<button
													type="button"
													onClick={() => void handleClearLookup()}
													disabled={actionBusy}
													className="mt-2 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
												>
													{t('clearBinding')}
												</button>
											</>
										) : (
											<p className="mt-1 text-slate-500">{t('lookupNone')}</p>
										)}
									</div>
								) : null}
							</div>

							{form.enabled ? (
								<div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3.5">
									<h3 className="text-sm font-semibold text-amber-900">{t('resetTitle')}</h3>
									<p className="mt-1 text-[11px] leading-relaxed text-amber-800">
										{t('resetHint')}
									</p>
									<button
										type="button"
										onClick={() => void handleResetPool()}
										disabled={actionBusy || saving}
										className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
									>
										{t('resetButton')}
									</button>
								</div>
							) : null}
						</>
					) : null}

					{actionMessage ? (
						<p className="text-xs text-emerald-700">{actionMessage}</p>
					) : null}
				</div>

				<div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-6 py-3.5">
					<button
						type="button"
						onClick={onClose}
						disabled={saving || actionBusy}
						className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={saving || actionBusy || !canSave || ttlOutOfRange}
						className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{saving ? tCommon('savingDots') : tCommon('save')}
					</button>
				</div>
			</div>
		</div>
	);
}
