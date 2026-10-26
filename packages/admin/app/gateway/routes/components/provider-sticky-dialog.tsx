'use client';

import {
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
import { StickyBindingTable, StickyBindingsListPanel } from './sticky-bindings-list';
import { StickyProviderIdentity } from './sticky-provider-identity';
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

const TTL_PRESETS = [3600, 7200, 21600];
const TABS = [
	{ id: 'settings', label: 'tabSettings' },
	{ id: 'distribution', label: 'tabDistribution' },
	{ id: 'bindings', label: 'tabBindings' },
	{ id: 'maintenance', label: 'tabMaintenance' },
] as const;

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
		!Number.isInteger(form.idleTtlSeconds) ||
		form.idleTtlSeconds < MIN_STICKY_IDLE_TTL_SECONDS ||
		form.idleTtlSeconds > MAX_STICKY_IDLE_TTL_SECONDS;

	const [summary, setSummary] = useState<StickyBindingsSummary | null>(null);
	const [summaryLoading, setSummaryLoading] = useState(false);
	const [summaryError, setSummaryError] = useState('');
	const [targetFilter, setTargetFilter] = useState('');
	const [userQuery, setUserQuery] = useState('');
	const [lookupLoading, setLookupLoading] = useState(false);
	const [lookupError, setLookupError] = useState('');
	const [lookup, setLookup] = useState<StickyBindingLookup | null>(null);
	const [actionBusy, setActionBusy] = useState(false);
	const [actionMessage, setActionMessage] = useState('');
	const [actionError, setActionError] = useState('');
	/** Bumped after lookup-unbind / pool reset so the user list reloads. */
	const [listReloadToken, setListReloadToken] = useState(0);
	const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>(
		dialog.enabled ? 'distribution' : 'settings'
	);
	const [customTtl, setCustomTtl] = useState(!TTL_PRESETS.includes(form.idleTtlSeconds));
	const [submittedQuery, setSubmittedQuery] = useState('');
	const [listBusy, setListBusy] = useState(false);
	const busy = saving || actionBusy || listBusy;
	const hasChanges =
		form.enabled !== dialog.enabled || form.idleTtlSeconds !== dialog.idleTtlSeconds;

	const targetMeta = useMemo(() => {
		const map = new Map(dialog.targets.map((row) => [row.id, row]));
		return map;
	}, [dialog.targets]);

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
		} catch {
			setSummary(null);
			setSummaryError(t('loadFailed'));
		} finally {
			setSummaryLoading(false);
		}
	}, [dialog.poolId, t]);

	useEffect(() => {
		void refreshSummary();
	}, [refreshSummary]);

	const handleLookup = async (query = userQuery) => {
		if (!dialog.poolId) return;
		const q = query.trim();
		if (!q) {
			setLookupError(t('lookupRequired'));
			return;
		}
		setSubmittedQuery(q);
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
		} catch {
			setLookupError(t('loadFailed'));
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
		setLookupError('');
		try {
			const result = await clearStickyBinding(dialog.poolId, lookup.affinity_hash);
			if (!result.success) {
				setLookupError(result.message);
				return;
			}
			setActionMessage(result.cleared ? t('clearDone') : t('clearMiss'));
			setLookup((prev) => (prev ? { ...prev, binding: null } : prev));
			setListReloadToken((n) => n + 1);
			await refreshSummary();
			await invalidate(dialog.poolId);
			onBindingsChanged?.();
		} catch {
			setLookupError(t('actionFailed'));
		} finally {
			setActionBusy(false);
		}
	};

	const handleResetPool = async () => {
		if (!dialog.poolId || hasChanges || busy) return;
		const ok = await confirm({
			title: t('resetTitle'),
			message: t('resetConfirm'),
			danger: true,
		});
		if (!ok) return;
		setActionBusy(true);
		setActionMessage('');
		setActionError('');
		try {
			const result = await resetStickyBindings(dialog.poolId);
			if (!result.success) {
				setActionError(result.message);
				return;
			}
			setActionMessage(t('resetDone'));
			setLookup((prev) => (prev ? { ...prev, binding: null } : prev));
			setListReloadToken((n) => n + 1);
			await refreshSummary();
			await invalidate(dialog.poolId);
			onBindingsChanged?.();
		} catch {
			setActionError(t('actionFailed'));
		} finally {
			setActionBusy(false);
		}
	};

	const distributionRows = useMemo(() => {
		const counts = new Map((summary?.targets ?? []).map((row) => [row.route_target_id, row]));
		const ids = new Set<string>([
			...dialog.targets.map((row) => row.id),
			...(summary?.targets ?? []).map((row) => row.route_target_id),
		]);
		return [...ids]
			.map((id) => {
				const meta = targetMeta.get(id);
				const countRow = counts.get(id);
				return {
					id,
					providerName: meta?.providerName ?? id,
					identity: meta?.identity,
					priority: meta?.priority ?? null,
					weight: meta?.weight ?? null,
					enabled: meta?.enabled,
					activeCount: countRow?.active_count ?? 0,
					bindingShare: countRow?.share ?? 0,
				};
			})
			.sort((a, b) => {
				if (a.priority === null) return b.priority === null ? b.activeCount - a.activeCount : 1;
				if (b.priority === null) return -1;
				return b.priority - a.priority || b.activeCount - a.activeCount;
			});
	}, [dialog.targets, summary, targetMeta]);

	const lookupTargetLabel = lookup?.binding
		? targetMeta.get(lookup.binding.route_target_id)?.providerName ?? lookup.binding.route_target_id
		: null;

	const distributionGroups = useMemo(() => {
		const groups = new Map<number | null, typeof distributionRows>();
		for (const row of distributionRows) {
			const group = groups.get(row.priority) ?? [];
			group.push(row);
			groups.set(row.priority, group);
		}
		return [...groups].map(([priority, rows]) => ({ priority, rows }));
	}, [distributionRows]);
	const refreshAll = () => {
		setListReloadToken((n) => n + 1);
		void refreshSummary();
		if (submittedQuery) void handleLookup(submittedQuery);
	};
	const resetLookup = () => {
		setUserQuery('');
		setSubmittedQuery('');
		setLookup(null);
		setLookupError('');
		setActionMessage('');
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-sticky-dialog-title"
			>
				<div className="flex shrink-0 items-start justify-between gap-3 px-6 pb-4 pt-5">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h2
								id="provider-sticky-dialog-title"
								className="text-base font-semibold text-gray-900"
							>
								{t('title')}
							</h2>
							<span
								className={`rounded-full px-2 py-0.5 text-xs font-medium ${
									dialog.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'
								}`}
							>
								{dialog.enabled ? t('statusOn') : t('statusOff')}
							</span>
						</div>
						<p className="mt-1.5 break-words text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">
								{dialog.requestOperation} · {dialog.group}
							</span>
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>

				<div
					role="tablist"
					aria-label={t('title')}
					className="flex shrink-0 gap-5 overflow-x-auto border-b border-gray-200 px-6"
				>
					{TABS.map(({ id: tab, label }) => (
						<button
							key={tab}
							id={`sticky-tab-${tab}`}
							role="tab"
							type="button"
							aria-selected={activeTab === tab}
							aria-controls={`sticky-panel-${tab}`}
							tabIndex={activeTab === tab ? 0 : -1}
							disabled={busy || (!canSave && tab !== 'settings')}
							onClick={() => setActiveTab(tab)}
							onKeyDown={(event) => {
								if (
									!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
									!canSave ||
									busy
								)
									return;
								event.preventDefault();
								const index = TABS.findIndex((item) => item.id === tab);
								const next =
									event.key === 'Home'
										? 0
										: event.key === 'End'
										? TABS.length - 1
										: (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
								setActiveTab(TABS[next].id);
								document.getElementById(`sticky-tab-${TABS[next].id}`)?.focus();
							}}
							className={`shrink-0 whitespace-nowrap border-b-2 py-3 text-sm font-medium focus-visible:outline-blue-500 disabled:opacity-50 ${
								activeTab === tab
									? 'border-blue-600 text-blue-600'
									: 'border-transparent text-gray-500 hover:text-gray-800'
							}`}
						>
							{t(label)}
						</button>
					))}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{error ? (
						<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
							{error}
						</p>
					) : null}
					<div
						role="tabpanel"
						id="sticky-panel-settings"
						aria-labelledby="sticky-tab-settings"
						hidden={activeTab !== 'settings'}
						className="space-y-5"
					>
						{!canSave ? (
							<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
								{t('requiresPool')}
							</p>
						) : null}
						<label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
							<input
								type="checkbox"
								checked={form.enabled}
								disabled={busy || !canSave}
								onChange={(event) => onFormChange({ ...form, enabled: event.target.checked })}
								className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
							/>
							<span>
								<span className="block text-sm font-medium text-gray-900">{t('enable')}</span>
								<span className="mt-1 block text-xs leading-relaxed text-gray-500">
									{t('scopeHint')}
								</span>
							</span>
						</label>
						<div className={!form.enabled ? 'opacity-60' : ''}>
							<h3 id="sticky-ttl-label" className="block text-sm font-medium text-gray-900">
								{t('idleTtl')}
							</h3>
							<p id="sticky-ttl-hint" className="mt-1 text-xs leading-relaxed text-gray-500">
								{t('idleTtlHint')}
							</p>
							<div
								role="group"
								aria-labelledby="sticky-ttl-label"
								className="mt-3 flex flex-wrap items-center gap-2"
							>
								{TTL_PRESETS.map((seconds) => (
									<button
										key={seconds}
										type="button"
										aria-pressed={!customTtl && form.idleTtlSeconds === seconds}
										disabled={busy || !canSave || !form.enabled}
										onClick={() => {
											setCustomTtl(false);
											onFormChange({ ...form, idleTtlSeconds: seconds });
										}}
										className={`h-8 shrink-0 rounded-md border px-3 text-xs disabled:cursor-not-allowed ${
											!customTtl && form.idleTtlSeconds === seconds
												? 'border-blue-200 bg-blue-50 font-medium text-blue-700'
												: 'border-gray-200 text-gray-600 hover:bg-gray-50'
										}`}
									>
										{t(`ttl${seconds}`)}
									</button>
								))}
								<div className="inline-flex shrink-0 items-center gap-2">
									<button
										type="button"
										aria-pressed={customTtl}
										disabled={busy || !canSave || !form.enabled}
										onClick={() => setCustomTtl(true)}
										className={`h-8 shrink-0 rounded-md border px-3 text-xs disabled:cursor-not-allowed ${
											customTtl
												? 'border-blue-200 bg-blue-50 font-medium text-blue-700'
												: 'border-gray-200 text-gray-600 hover:bg-gray-50'
										}`}
									>
										{t('ttlCustom')}
									</button>
									{customTtl ? (
										<>
											<input
												id="provider-sticky-idle-ttl"
												aria-label={t('customTtlLabel')}
												type="number"
												min={MIN_STICKY_IDLE_TTL_SECONDS}
												max={MAX_STICKY_IDLE_TTL_SECONDS}
												step={1}
												value={form.idleTtlSeconds}
												disabled={busy || !canSave || !form.enabled}
												aria-describedby="sticky-ttl-hint sticky-ttl-range"
												aria-invalid={ttlOutOfRange}
												onChange={(event) =>
													onFormChange({ ...form, idleTtlSeconds: Number(event.target.value) })
												}
												className="h-8 w-24 rounded-md border border-gray-300 px-2 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50"
											/>
											<span className="text-xs text-gray-500">{t('seconds')}</span>
										</>
									) : null}
								</div>
							</div>
							{customTtl ? (
								<p
									id="sticky-ttl-range"
									className={`mt-1.5 text-xs ${ttlOutOfRange ? 'text-red-600' : 'text-gray-500'}`}
								>
									{t('ttlRange', {
										min: MIN_STICKY_IDLE_TTL_SECONDS,
										max: MAX_STICKY_IDLE_TTL_SECONDS,
									})}
								</p>
							) : null}
						</div>
						<div className="rounded-lg bg-blue-50/60 p-4 text-xs leading-relaxed text-gray-600">
							<h3 className="font-semibold text-gray-900">{t('effectTitle')}</h3>
							<p className="mt-2">{t('behaviorHint')}</p>
							<p className="mt-2">{t('poolSharedHint')}</p>
						</div>
						{!form.enabled ? (
							<p className="text-xs leading-relaxed text-gray-500">{t('disabledHint')}</p>
						) : null}
					</div>

					<div
						role="tabpanel"
						id="sticky-panel-distribution"
						aria-labelledby="sticky-tab-distribution"
						hidden={activeTab !== 'distribution'}
						className="space-y-5"
					>
						{!dialog.enabled ? (
							<p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
								{t('offBindingsHint')}
							</p>
						) : null}
						<div>
							<div className="flex items-center justify-between gap-3">
								<div className="flex items-baseline gap-2">
									<span className="text-2xl font-semibold tabular-nums text-gray-900">
										{summary ? summary.total_active : '—'}
									</span>
									<h3 className="text-sm text-gray-600">{t('activeBindings')}</h3>
								</div>
								<button
									type="button"
									onClick={refreshAll}
									disabled={summaryLoading || lookupLoading || busy}
									className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
								>
									{summaryLoading ? tCommon('loadingEllipsis') : t('refresh')}
								</button>
							</div>
							<p className="mt-1 text-xs leading-relaxed text-gray-500">{t('distributionHint')}</p>
							{summaryError ? (
								<p role="alert" className="mt-2 text-xs text-red-600">
									{summaryError}
								</p>
							) : null}
						</div>
						<div className="rounded-lg bg-blue-50/60 p-3 text-xs leading-relaxed text-gray-600">
							<p>{t('priorityHint')}</p>
							<p className="mt-1">{t('weightHint')}</p>
						</div>
						{summary ? (
							distributionGroups.map((group) => (
								<section
									key={group.priority ?? 'unknown'}
									className="overflow-hidden rounded-lg border border-gray-200"
								>
									<h3 className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-800">
										{group.priority !== null
											? t('priorityGroup', { priority: group.priority })
											: t('unknownTargets')}
									</h3>
									<div className="overflow-x-auto">
										<table className="w-full min-w-[32rem] table-fixed text-left text-xs">
											<colgroup>
												<col />
												<col className="w-16" />
												<col className="w-20" />
												<col className="w-32" />
											</colgroup>
											<thead className="text-gray-500">
												<tr>
													<th scope="col" className="px-4 py-2 font-normal">
														{t('providerColumn')}
													</th>
													<th
														scope="col"
														className="whitespace-nowrap px-3 py-2 text-right font-normal"
													>
														{t('weightColumn')}
													</th>
													<th
														scope="col"
														className="whitespace-nowrap px-3 py-2 text-right font-normal"
													>
														{t('countColumn')}
													</th>
													<th
														scope="col"
														className="whitespace-nowrap px-4 py-2 text-right font-normal"
													>
														{t('bindingShare')}
													</th>
												</tr>
											</thead>
											<tbody>
												{group.rows.map((row) => (
													<tr key={row.id} className="border-t border-gray-100">
														<td className="px-4 py-3">
															<StickyProviderIdentity
																identity={row.identity}
																fallbackName={row.providerName}
																enabled={row.enabled}
															/>
														</td>
														<td className="px-3 py-3 text-right font-mono text-gray-600">
															{row.weight ?? '—'}
														</td>
														<td className="px-3 py-3 text-right tabular-nums text-gray-700">
															<button
																type="button"
																disabled={busy}
																aria-label={t('viewProviderBindings', {
																	provider: row.providerName,
																	count: row.activeCount,
																})}
																onClick={() => {
																	resetLookup();
																	setTargetFilter(row.id);
																	setActiveTab('bindings');
																	document.getElementById('sticky-tab-bindings')?.focus();
																}}
																className="min-w-8 rounded-md px-2 py-1 font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
															>
																{row.activeCount}
															</button>
														</td>
														<td className="w-28 px-4 py-3">
															<p className="text-right tabular-nums text-gray-600">
																{Math.round(row.bindingShare * 100)}%
															</p>
															<div className="mt-1 h-1 rounded-full bg-gray-100">
																<div
																	className="h-full rounded-full bg-emerald-500"
																	style={{ width: `${Math.round(row.bindingShare * 100)}%` }}
																/>
															</div>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</section>
							))
						) : (
							<p className="text-xs text-gray-500">
								{summaryLoading ? tCommon('loadingEllipsis') : t('distributionEmpty')}
							</p>
						)}
					</div>

					<div
						role="tabpanel"
						id="sticky-panel-bindings"
						aria-labelledby="sticky-tab-bindings"
						hidden={activeTab !== 'bindings'}
						className="space-y-5"
					>
						{!dialog.enabled ? (
							<p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
								{t('offBindingsHint')}
							</p>
						) : null}

						{activeTab === 'bindings' && dialog.poolId ? (
							<StickyBindingsListPanel
								poolId={dialog.poolId}
								targets={distributionRows}
								targetFilter={targetFilter}
								onTargetFilterChange={setTargetFilter}
								reloadToken={listReloadToken}
								disabled={busy}
								onBusyChange={setListBusy}
								onRefresh={refreshAll}
								refreshing={summaryLoading || lookupLoading}
								onChanged={() => {
									void refreshSummary();
									void invalidate(dialog.poolId!);
									onBindingsChanged?.();
								}}
								search={
									<form
										onSubmit={(event) => {
											event.preventDefault();
											void handleLookup();
										}}
										className="space-y-2"
									>
										<div className="flex flex-wrap gap-2">
											<input
												type="text"
												value={userQuery}
												onChange={(event) => setUserQuery(event.target.value)}
												aria-label={t('lookupPlaceholder')}
												placeholder={t('lookupPlaceholder')}
												disabled={lookupLoading || busy}
												className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50"
											/>
											<button
												type="submit"
												disabled={lookupLoading || busy}
												className="rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
											>
												{lookupLoading ? tCommon('loadingEllipsis') : t('lookup')}
											</button>
											{submittedQuery ? (
												<button
													type="button"
													onClick={resetLookup}
													disabled={lookupLoading || busy}
													className="rounded-md px-2 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
												>
													{t('backToList')}
												</button>
											) : null}
										</div>
										<p className="text-xs leading-relaxed text-gray-500">{t('lookupHint')}</p>
										{!submittedQuery && lookupError ? (
											<p role="alert" className="text-xs text-red-600">
												{lookupError}
											</p>
										) : null}
									</form>
								}
								searchResult={
									submittedQuery ? (
										<div aria-live="polite" className="mt-3 space-y-2">
											{lookupLoading ? (
												<p className="text-xs text-gray-500">{tCommon('loadingEllipsis')}</p>
											) : null}
											{lookupError ? (
												<p role="alert" className="text-xs text-red-600">
													{lookupError}
												</p>
											) : null}
											{actionMessage ? (
												<p role="status" className="text-xs text-emerald-700">
													{actionMessage}
												</p>
											) : null}
											{lookup?.binding ? (
												<StickyBindingTable
													rows={[
														{
															id: lookup.affinity_hash,
															userLabel: submittedQuery,
															userHint: lookup.user_id,
															providerLabel: lookupTargetLabel ?? lookup.binding.route_target_id,
															providerIdentity: targetMeta.get(lookup.binding.route_target_id)
																?.identity,
															expiresAt: lookup.binding.expires_at,
															status: !lookup.binding.epoch_valid
																? 'invalid'
																: lookup.binding.expired
																? 'expired'
																: undefined,
														},
													]}
													disabled={busy}
													onUnbind={() => void handleClearLookup()}
												/>
											) : lookup ? (
												<p className="text-xs text-gray-500">{t('lookupNone')}</p>
											) : null}
										</div>
									) : undefined
								}
							/>
						) : null}
					</div>

					<div
						role="tabpanel"
						id="sticky-panel-maintenance"
						aria-labelledby="sticky-tab-maintenance"
						hidden={activeTab !== 'maintenance'}
						className="space-y-5"
					>
						<div className="rounded-lg border border-gray-200 p-4">
							<div className="flex items-center justify-between gap-3">
								<h3 className="text-sm font-semibold text-gray-900">{t('historyTitle')}</h3>
								<button
									type="button"
									onClick={() => void refreshSummary()}
									disabled={summaryLoading || busy}
									className="rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
								>
									{summaryLoading ? tCommon('loadingEllipsis') : t('refresh')}
								</button>
							</div>
							<p className="mt-2 text-sm text-gray-700">
								{t('historyCount', { count: summary?.stale_count ?? '—' })}
							</p>
							<p className="mt-1 text-xs leading-relaxed text-gray-500">{t('historyHint')}</p>
							{summaryError ? (
								<p role="alert" className="mt-2 text-xs text-red-600">
									{summaryError}
								</p>
							) : null}
						</div>
						<div className="rounded-lg border border-red-200 bg-red-50/30 p-4">
							<h3 className="text-sm font-semibold text-gray-900">{t('resetTitle')}</h3>
							<p className="mt-2 text-xs leading-relaxed text-gray-600">{t('resetHint')}</p>
							<p className="mt-2 text-xs leading-relaxed text-gray-500">{t('resetScopeHint')}</p>
							{hasChanges ? (
								<p className="mt-3 text-xs text-amber-800">{t('maintenanceUnsavedHint')}</p>
							) : null}
							<button
								type="button"
								onClick={() => void handleResetPool()}
								disabled={
									busy || hasChanges || summaryLoading || !summary || summary.total_active === 0
								}
								className="mt-4 rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{t('resetButton')}
							</button>
							{summary?.total_active === 0 ? (
								<p className="mt-2 text-xs text-gray-500">{t('nothingToReset')}</p>
							) : null}
						</div>
						{actionError ? (
							<p role="alert" className="text-xs text-red-600">
								{actionError}
							</p>
						) : null}
						{actionMessage ? (
							<p role="status" className="text-xs text-emerald-700">
								{actionMessage}
							</p>
						) : null}
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-6 py-3.5">
					{hasChanges ? (
						<span role="status" className="mr-auto text-xs text-amber-700">
							{t('unsavedHint')}
						</span>
					) : null}
					{hasChanges ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setCustomTtl(!TTL_PRESETS.includes(dialog.idleTtlSeconds));
								onFormChange({ enabled: dialog.enabled, idleTtlSeconds: dialog.idleTtlSeconds });
							}}
							className="rounded-md px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
						>
							{t('discardChanges')}
						</button>
					) : null}
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
					>
						{hasChanges ? tCommon('cancel') : tCommon('close')}
					</button>
					{activeTab === 'settings' || hasChanges ? (
						<button
							type="button"
							onClick={onSave}
							disabled={busy || !canSave || !hasChanges || ttlOutOfRange}
							className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{saving ? tCommon('savingDots') : t('saveSettings')}
						</button>
					) : null}
				</div>
			</div>
		</div>
	);
}
