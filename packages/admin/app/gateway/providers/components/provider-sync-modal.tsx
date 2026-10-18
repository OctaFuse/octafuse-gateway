'use client';

import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import { pickProviderKindLabel } from '@/lib/provider-kind';
import type {
	ProviderSyncEndpointField,
	ProviderSyncField,
	ProviderSyncKindGroup,
	ProviderSyncProviderEntry,
	ProviderSyncStatus,
} from '@/lib/provider-sync-diff';
import {
	PROVIDER_SYNC_ORPHANS_KEY,
	syncSelectionKey,
	type ProviderSyncState,
} from '../use-provider-sync';

type ProviderSyncModalProps = {
	sync: ProviderSyncState;
};

function syncKindLabel(
	item: { label_en: string; label_zh: string; label_ja: string; label_ko: string },
	locale: string,
): string {
	return pickProviderKindLabel(
		{ en: item.label_en, zh: item.label_zh, ja: item.label_ja, ko: item.label_ko },
		locale,
	);
}

const STATUS_STYLE: Record<ProviderSyncStatus, string> = {
	added: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	changed: 'bg-amber-50 text-amber-800 ring-amber-200',
	removed: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function Value({ value, tone }: { value: string | null; tone: 'old' | 'new' | 'none' }) {
	if (value === null) {
		return <span className="text-gray-300">—</span>;
	}
	const toneClass =
		tone === 'old' ? 'bg-red-50 text-red-900' : tone === 'new' ? 'bg-emerald-50 text-emerald-900' : '';
	return (
		<span className={`break-all rounded px-1 py-0.5 font-mono text-[11px] leading-5 ${toneClass}`}>{value}</span>
	);
}

function EndpointDiff({ field }: { field: ProviderSyncEndpointField }) {
	const t = useTranslations('providers.sync');
	const slotLabel = (slot: string) =>
		slot === 'base' ? t('slot.base') : slot === 'auth' ? t('slot.auth') : slot;
	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[32rem] table-fixed text-left text-xs">
				<thead>
					<tr className="text-gray-500">
						<th className="w-32 py-1 pr-2 font-medium">{t('slot.title')}</th>
						<th className="py-1 pr-2 font-medium">{t('current')}</th>
						<th className="py-1 font-medium">{t('official')}</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-100 align-top">
					{field.rows.map((row) => (
						<tr key={row.slot}>
							<td className="py-1.5 pr-2 font-mono text-[11px] text-gray-600">{slotLabel(row.slot)}</td>
							<td className="py-1.5 pr-2">
								<Value value={row.current} tone={row.current === null ? 'none' : 'old'} />
							</td>
							<td className="py-1.5">
								<Value value={row.official} tone={row.official === null ? 'none' : 'new'} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function FieldBlock(props: {
	provider: ProviderSyncProviderEntry;
	field: ProviderSyncField;
	apply: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	const { provider, field, apply, disabled, onToggle } = props;
	const t = useTranslations('providers.sync');
	const tUpstream = useTranslations('upstream');
	const title = t('field.endpoints', { protocol: tUpstream(field.protocol) });

	const choose = (wantApply: boolean) => {
		if (wantApply !== apply) onToggle();
	};
	const segment = (active: boolean, tone: 'official' | 'keep') =>
		`px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${
			active
				? tone === 'official'
					? 'bg-blue-600 text-white'
					: 'bg-slate-700 text-white'
				: 'bg-white text-gray-600 hover:bg-gray-50'
		}`;

	return (
		<div
			className={`rounded-lg border p-3 ${apply ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'}`}
		>
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<h4 className="text-sm font-semibold text-gray-900">{title}</h4>
				<span
					className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLE[field.status]}`}
				>
					{t(`status.${field.status}`)}
				</span>
				<div
					role="radiogroup"
					aria-label={`${provider.provider_name} · ${title}`}
					className="ml-auto inline-flex overflow-hidden rounded-md border border-gray-300"
				>
					<button
						type="button"
						role="radio"
						aria-checked={apply}
						disabled={disabled}
						onClick={() => choose(true)}
						className={segment(apply, 'official')}
					>
						{t('useOfficial')}
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={!apply}
						disabled={disabled}
						onClick={() => choose(false)}
						className={`border-l border-gray-300 ${segment(!apply, 'keep')}`}
					>
						{t('keepCurrent')}
					</button>
				</div>
			</div>
			{field.status === 'removed' ? (
				<p className="mb-2 text-xs text-gray-500">{t('removedHint')}</p>
			) : null}
			<EndpointDiff field={field} />
		</div>
	);
}

function ProviderBlock(props: { sync: ProviderSyncState; provider: ProviderSyncProviderEntry }) {
	const { sync, provider } = props;
	const t = useTranslations('providers.sync');
	const tCard = useTranslations('providers.card');
	const selectedCount = sync.selectedFieldsOf(provider).length;

	return (
		<section className="rounded-xl border border-gray-200 bg-white shadow-sm">
			<header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
				<h3 className="min-w-0 truncate text-sm font-semibold text-gray-900">{provider.provider_name}</h3>
				{provider.status === 'disabled' ? (
					<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
						{tCard('disabled')}
					</span>
				) : null}
				<span className="text-xs text-gray-500">
					{provider.routes_count <= 0
						? tCard('noRoutes')
						: `${tCard(provider.routes_count === 1 ? 'routes' : 'routesPlural', { count: provider.routes_count })} · ${tCard('activeRoutes', { count: provider.active_routes_count })}`}
				</span>
				<button
					type="button"
					onClick={() => void sync.runApply([provider.provider_id])}
					disabled={sync.submitting || selectedCount === 0}
					className="ml-auto rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
				>
					{t('applyProvider', { count: selectedCount })}
				</button>
			</header>
			<div className="space-y-3 p-4">
				{provider.fields.map((field) => (
					<FieldBlock
						key={field.key}
						provider={provider}
						field={field}
						apply={Boolean(sync.selection[syncSelectionKey(provider.provider_id, field.key)])}
						disabled={sync.submitting}
						onToggle={() => sync.toggleField(provider.provider_id, field.key)}
					/>
				))}
			</div>
		</section>
	);
}

function GroupPanel({ sync, group }: { sync: ProviderSyncState; group: ProviderSyncKindGroup }) {
	const t = useTranslations('providers.sync');
	const locale = useLocale();
	const label = syncKindLabel(group, locale);
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<VendorIcon vendor={group.vendor_key} iconKey={group.icon_key} size="compact" />
				<div className="min-w-0">
					<h3 className="truncate text-base font-semibold text-gray-900">{label}</h3>
					<p className="text-xs text-gray-500">{t('groupHint')}</p>
				</div>
				<div className="ml-auto flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => sync.setGroupFields(group, true)}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						{t('useOfficialAll')}
					</button>
					<button
						type="button"
						onClick={() => sync.setGroupFields(group, false)}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						{t('keepCurrentAll')}
					</button>
				</div>
			</div>
			{group.providers.map((provider) => (
				<ProviderBlock key={provider.provider_id} sync={sync} provider={provider} />
			))}
		</div>
	);
}

function OrphansPanel({ sync }: { sync: ProviderSyncState }) {
	const t = useTranslations('providers.sync.orphans');
	const tCard = useTranslations('providers.card');
	const locale = useLocale();
	const report = sync.report;
	if (!report) return null;
	return (
		<div className="space-y-4">
			<div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
				<ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
				<p>{t('intro')}</p>
			</div>
			<ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
				{report.orphans.map((orphan) => {
					const busy = sync.orphanBusyId === orphan.provider_id;
					const target = sync.orphanChoice[orphan.provider_id] ?? '';
					return (
						<li key={orphan.provider_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-semibold text-gray-900">{orphan.provider_name}</p>
								<p className="text-xs text-gray-500">
									{t('oldKind')}: <span className="font-mono">{orphan.kind}</span>
									{' · '}
									{orphan.routes_count <= 0
										? tCard('noRoutes')
										: tCard(orphan.routes_count === 1 ? 'routes' : 'routesPlural', {
												count: orphan.routes_count,
											})}
								</p>
							</div>
							<select
								value={target}
								onChange={(e) => sync.setOrphanTarget(orphan.provider_id, e.target.value)}
								disabled={busy || sync.submitting}
								aria-label={t('pickTarget')}
								className="min-h-9 min-w-[12rem] rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
							>
								<option value="">{t('pickTarget')}</option>
								{report.kind_choices.map((choice) => (
									<option key={choice.kind} value={choice.kind}>
										{syncKindLabel(choice, locale)}
										{choice.kind === orphan.suggested_kind ? ` (${t('suggested')})` : ''}
									</option>
								))}
							</select>
							<button
								type="button"
								onClick={() => void sync.migrateOrphan(orphan.provider_id)}
								disabled={busy || sync.submitting || !target}
								className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
							>
								{busy ? t('migrating') : t('migrate')}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function ProviderSyncModal({ sync }: ProviderSyncModalProps) {
	const t = useTranslations('providers.sync');
	const tCommon = useTranslations('common');
	const locale = useLocale();

	if (!sync.open) return null;

	const report = sync.report;
	const hasAnything = Boolean(report && (report.groups.length > 0 || report.orphans.length > 0));
	const activeGroup =
		report && sync.activeKey && sync.activeKey !== PROVIDER_SYNC_ORPHANS_KEY
			? report.groups.find((g) => g.kind === sync.activeKey)
			: undefined;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !sync.submitting) sync.close();
			}}
		>
			<div
				className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="provider-sync-title"
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b px-6 py-4">
					<div>
						<h2 id="provider-sync-title" className="text-xl font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">{t('subtitle')}</p>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => void sync.reload()}
							disabled={sync.loading || sync.submitting}
							className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
							aria-label={t('recheck')}
							title={t('recheck')}
						>
							<ArrowPathIcon className={`h-5 w-5 ${sync.loading ? 'animate-spin' : ''}`} aria-hidden />
						</button>
						<button
							type="button"
							onClick={sync.close}
							disabled={sync.submitting}
							className="px-2 text-2xl leading-none text-gray-400 hover:text-gray-600 disabled:opacity-50"
							aria-label={tCommon('close')}
						>
							×
						</button>
					</div>
				</div>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					{hasAnything && report ? (
						<nav
							className="max-h-48 shrink-0 overflow-y-auto border-b bg-gray-50 p-2 md:max-h-none md:w-72 md:border-b-0 md:border-r"
							aria-label={t('navAria')}
						>
							<ul className="space-y-1">
								{report.groups.map((group) => {
									const fieldCount = group.providers.reduce((n, p) => n + p.fields.length, 0);
									const active = sync.activeKey === group.kind;
									return (
										<li key={group.kind}>
											<button
												type="button"
												onClick={() => sync.setActiveKey(group.kind)}
												aria-current={active ? 'true' : undefined}
												className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
													active ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-100'
												}`}
											>
												<VendorIcon vendor={group.vendor_key} iconKey={group.icon_key} size="compact" />
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">
														{syncKindLabel(group, locale)}
													</span>
													<span className="block text-[11px] text-gray-500">
														{t('groupSummary', {
															providers: group.providers.length,
															fields: fieldCount,
														})}
													</span>
												</span>
											</button>
										</li>
									);
								})}
								{report.orphans.length > 0 ? (
									<li>
										<button
											type="button"
											onClick={() => sync.setActiveKey(PROVIDER_SYNC_ORPHANS_KEY)}
											aria-current={sync.activeKey === PROVIDER_SYNC_ORPHANS_KEY ? 'true' : undefined}
											className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
												sync.activeKey === PROVIDER_SYNC_ORPHANS_KEY
													? 'bg-amber-100 text-amber-900'
													: 'text-gray-700 hover:bg-gray-100'
											}`}
										>
											<ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-amber-600" aria-hidden />
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">{t('orphans.navTitle')}</span>
												<span className="block text-[11px] text-gray-500">
													{t('orphans.navCount', { count: report.orphans.length })}
												</span>
											</span>
										</button>
									</li>
								) : null}
							</ul>
						</nav>
					) : null}

					<div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/50 px-6 py-5">
						{sync.loading && !report ? (
							<div className="py-16 text-center text-gray-600">{t('loading')}</div>
						) : null}
						{sync.error ? (
							<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
								{sync.error}
							</div>
						) : null}
						{report && !sync.error && !hasAnything ? (
							<div className="flex flex-col items-center gap-3 py-16 text-center">
								<CheckCircleIcon className="h-12 w-12 text-emerald-500" aria-hidden />
								<p className="text-base font-medium text-gray-900">{t('allSyncedTitle')}</p>
								<p className="max-w-md text-sm text-gray-500">{t('allSyncedHint')}</p>
							</div>
						) : null}
						{activeGroup ? <GroupPanel sync={sync} group={activeGroup} /> : null}
						{report && sync.activeKey === PROVIDER_SYNC_ORPHANS_KEY ? <OrphansPanel sync={sync} /> : null}
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-gray-50 px-6 py-4">
					<div className="min-w-0 flex-1 text-sm text-gray-600">
						<p>
							{t('summary', {
								fields: sync.totals.fields,
								providers: sync.totals.providers,
							})}
							{sync.totals.activeRoutes > 0 ? (
								<span className="ml-1 text-amber-700">
									{t('summaryRoutes', { routes: sync.totals.activeRoutes })}
								</span>
							) : null}
						</p>
						<p className="mt-0.5 text-xs text-gray-400">{t('safeNote')}</p>
					</div>
					{report && report.groups.length > 0 ? (
						<button
							type="button"
							onClick={sync.resetToDefaults}
							disabled={sync.submitting}
							className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
						>
							{t('resetDefaults')}
						</button>
					) : null}
					<button
						type="button"
						onClick={sync.close}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white disabled:opacity-50"
					>
						{tCommon('close')}
					</button>
					<button
						type="button"
						onClick={() => void sync.runApply()}
						disabled={sync.submitting || sync.loading || sync.totals.fields === 0}
						className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{sync.submitting ? t('applying') : t('applyAll', { count: sync.totals.providers })}
					</button>
				</div>
			</div>
		</div>
	);
}
