'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
	MagnifyingGlassIcon,
	DocumentTextIcon,
	BeakerIcon,
	ShieldCheckIcon,
	ServerStackIcon,
	AdjustmentsHorizontalIcon,
	ClockIcon,
	LinkIcon,
	BookOpenIcon,
	KeyIcon,
	ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { useProxyBaseUrlInput } from '@/components/proxy-connection-provider';
import { ProxyConnectionHint } from '@/components/proxy-connection-hint';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { AdminDialog } from '@/components/admin-dialog';
import { formatGatewayMoneyCompact } from '@/lib/format-gateway-currency';
import { GATEWAY_TOOLS } from '@/lib/gateway-tools';
import { ToolApiReference, ToolEndpoint, type ToolReferenceView } from './tool-api-guide';
import { TOOL_API_DEFINITIONS, isRestToolId, normalizeToolProxyUrl } from '../tool-api-guide';
import styles from './tool-provider-list.module.css';
import { ToolEngineDetails } from './tool-engine-details';
import { providerActivationBlock } from '../tool-provider-activation';
import { toolConfigurationState } from '../tool-workspace-state';
import {
	getPriceSummaryParts,
	parseDraftMoney,
	priceMultiplier,
	type PriceTripleDraft,
	type ProviderCardStatusFlags,
} from './provider-card-state';

type ServiceItem = {
	id: string;
	label: string;
	prices: PriceTripleDraft;
	savedPrices: PriceTripleDraft;
	savedConfigured: boolean;
	status: ProviderCardStatusFlags;
	unitLabel?: string;
	savedUnitLabel?: string;
};
export type ToolProviderGroup = {
	id: string;
	label: string;
	description: string;
	unitLabel: string;
	items: ServiceItem[];
	onSelect: (id: string) => void;
	onActivate: (id: string) => void;
	busy: boolean;
	activatingId: string | null;
	feedback?: { kind: 'success' | 'error'; message: string };
};
const TYPE_ICONS: Record<string, typeof ServerStackIcon> = {
	'web-search': MagnifyingGlassIcon,
	'web-fetch': DocumentTextIcon,
	'web-deep-search': BeakerIcon,
	'ai-detection': ShieldCheckIcon,
};
const TYPE_TONES: Record<string, string> = {
	'web-search': 'bg-blue-50 text-blue-600',
	'web-fetch': 'bg-teal-50 text-teal-600',
	'web-deep-search': 'bg-violet-50 text-violet-600',
	'ai-detection': 'bg-amber-50 text-amber-600',
};

export function ToolProviderList({
	groups,
	currency,
	searchRef,
}: {
	groups: ToolProviderGroup[];
	currency: string;
	searchRef: RefObject<HTMLInputElement>;
}) {
	const t = useTranslations('tools.workspace');
	const list = useTranslations('tools.serviceList');
	const api = useTranslations('tools.apiGuide');
	const badges = useTranslations('tools.providerCards');
	const ui = useTranslations('tools.ui');
	const priceLabels = useTranslations('tools.unitPrices');
	const proxyConnection = useProxyBaseUrlInput();
	const proxyBaseUrl = proxyConnection.value;
	const proxyInvalid = proxyBaseUrl.trim() !== '' && normalizeToolProxyUrl(proxyBaseUrl) == null;
	const [addressOpen, setAddressOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [selectedId, setSelectedId] = useState(groups[0]?.id ?? '');
	const [view, setView] = useState<ToolReferenceView>('api');
	useEffect(() => {
		const revealAnchor = () => {
			const id = window.location.hash.slice(1);
			if (!GATEWAY_TOOLS.some((tool) => tool.configAnchor === id)) return;
			setSelectedId(id);
			setQuery('');
		};
		revealAnchor();
		window.addEventListener('hashchange', revealAnchor);
		return () => window.removeEventListener('hashchange', revealAnchor);
	}, []);

	const search = query.trim().toLocaleLowerCase();
	const visibleGroups = groups.filter(
		(group) =>
			!search ||
			[
				group.id,
				group.label,
				group.description,
				...(isRestToolId(group.id) ? [TOOL_API_DEFINITIONS[group.id].name] : []),
				...group.items.flatMap((item) => [item.id, item.label]),
			].some((value) => value.toLocaleLowerCase().includes(search))
	);
	const selected = groups.find((group) => group.id === selectedId) ?? groups[0];
	const current = selected ? toolConfigurationState(selected.items) : null;
	const Icon = selected ? TYPE_ICONS[selected.id] ?? ServerStackIcon : ServerStackIcon;
	const selectedDefinition = selected && isRestToolId(selected.id) ? TOOL_API_DEFINITIONS[selected.id] : null;
	function chooseTool(id: string) {
		setSelectedId(id);
		window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
	}

	const tabs = ['api', 'agent'] as const;
	const amount = (raw: string) => {
		const n = parseDraftMoney(raw);
		return n == null ? '—' : formatGatewayMoneyCompact(n, currency);
	};
	return (
		<section className="min-w-0" aria-label={list('tools')}>
			<div className="grid min-w-0 items-start gap-4 xl:grid-cols-[208px_minmax(0,1fr)]">
				<aside className="min-w-0 space-y-2" aria-label={t('directory')}>
					<div className="flex items-center justify-between px-1">
						<h2 className="text-sm font-medium text-gray-900">{t('directory')}</h2>
						<span className="font-mono text-xs text-gray-400">{groups.length}</span>
					</div>
					<div className="relative">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
							aria-hidden="true"
						/>
						<input
							ref={searchRef}
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							aria-label={list('search')}
							placeholder={list('search')}
							className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-xs focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
						/>
					</div>
					<div role="group" aria-label={t('selectTool')} className="grid grid-cols-2 gap-2 xl:grid-cols-1">
						{visibleGroups.map((group) => {
							const Mark = TYPE_ICONS[group.id] ?? ServerStackIcon;
							const state = toolConfigurationState(group.items);
							return (
								<button
									key={group.id}
									type="button"
									aria-pressed={selected?.id === group.id}
									onClick={() => chooseTool(group.id)}
									className={`flex min-h-16 min-w-0 items-start gap-2 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
										selected?.id === group.id
											? 'border-gray-300 bg-white shadow-sm'
											: 'border-transparent hover:bg-white/70'
									}`}
								>
									<span
										className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TYPE_TONES[group.id]}`}
									>
										<Mark className="h-4 w-4" aria-hidden="true" />
									</span>
									<span className="min-w-0">
										<span className="block text-sm font-medium leading-5 text-gray-900">{group.label}</span>
										<span
											className={`mt-1 flex flex-wrap items-center gap-1.5 text-xs ${
												state.ready ? 'text-emerald-700' : 'text-gray-500'
											}`}
										>
											<span
												className={`h-1.5 w-1.5 shrink-0 rounded-full ${
													state.ready ? 'bg-emerald-500' : 'bg-gray-300'
												}`}
												aria-hidden="true"
											/>
											{state.ready ? t('configured') : ui('notConfigured')}
											{state.dirty ? <span className="text-amber-700">· {badges('unsaved')}</span> : null}
										</span>
									</span>
								</button>
							);
						})}
					</div>
					{visibleGroups.length === 0 ? <p className="px-1 text-xs leading-5 text-gray-500">{t('noMatches')}</p> : null}
					{search ? (
						<button
							type="button"
							onClick={() => setQuery('')}
							className="px-1 text-xs text-gray-500 hover:text-gray-900"
						>
							{list('clearFilters')}
						</button>
					) : null}
				</aside>
				{selected && current ? (
					<section id={selected.id} aria-labelledby="rest-tool-heading" className="min-w-0 space-y-4">
						<header className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="flex min-w-0 flex-1 items-start gap-3">
									<span
										className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
											TYPE_TONES[selected.id]
										}`}
									>
										<Icon className="h-5 w-5" aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
											<h2 id="rest-tool-heading" className="text-lg font-medium text-gray-900">
												{selected.label}
											</h2>
											<code className="break-all font-mono text-xs text-gray-400">{selectedDefinition?.name}</code>
										</div>
										<p className="mt-1 text-xs leading-5 text-gray-500">{selected.description}</p>
									</div>
								</div>
								<div className="flex w-full flex-wrap items-center gap-3 text-xs sm:w-auto">
									<Link
										href={`/gateway/tools/invocations?source=rest&tool=${selected.id}`}
										className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-900"
									>
										<ClockIcon className="h-4 w-4" aria-hidden="true" />
										{ui('invocations')}
									</Link>
									<Link
										href={`/gateway/playground?mode=tools&tool=${selected.id}${
											current.active ? `&provider=${encodeURIComponent(current.active.id)}` : ''
										}`}
										title={ui('testSavedConfig')}
										className="inline-flex items-center gap-1.5 text-gray-700 hover:text-gray-900"
									>
										<BeakerIcon className="h-4 w-4" aria-hidden="true" />
										{t('testTool')}
									</Link>
									<button
										type="button"
										onClick={() => setAddressOpen(true)}
										aria-haspopup="dialog"
										className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50"
									>
										<LinkIcon className="h-4 w-4" aria-hidden="true" />
										{t('addressSettings')}
									</button>
								</div>
							</div>
							{isRestToolId(selected.id) ? <ToolEndpoint toolId={selected.id} baseUrl={proxyBaseUrl} /> : null}
							{current.active ? (
								<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs">
									<div className="min-w-0">
										<span className="text-gray-500">{t('appliedProvider')}</span>
										<span className="ml-2 font-medium text-gray-900">{current.active.label}</span>
										{!current.ready ? <span className="ml-2 text-amber-700">{ui('notConfigured')}</span> : null}
										<span className="ml-3 text-gray-400">{current.active.savedUnitLabel ?? selected.unitLabel}</span>
									</div>
									<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
										{(['standard', 'charged', 'metered'] as const).map((kind) => (
											<span key={kind} className="whitespace-nowrap text-gray-500">
												{priceLabels(kind)}{' '}
												<span className="font-mono tabular-nums text-gray-800">
													{amount(current.active!.savedPrices[kind])}
												</span>
											</span>
										))}
									</div>
								</div>
							) : (
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3 text-xs">
									<p className="leading-5 text-amber-800">{t('setupHint')}</p>
								</div>
							)}
						</header>
						<section
							aria-labelledby={`${selected.id}-providers-heading`}
							className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
						>
							<div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2">
								<AdjustmentsHorizontalIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
								<h3 id={`${selected.id}-providers-heading`} className="text-sm font-medium text-gray-900">
									{t('tabs.providers')}
								</h3>
								<span className="text-xs text-gray-400">{selected.items.length}</span>
								<InfoHintPopover label={t('providersHelp')} openOnHover openOnFocus portal align="start">
									<p className="leading-5">{t('providersHint')}</p>
								</InfoHintPopover>
								<span className="ml-auto text-xs text-gray-500">{list('savedConfigHint')}</span>
								{current.dirty ? <span className="ml-auto text-xs text-amber-700">{badges('unsaved')}</span> : null}
							</div>
							<div className="min-w-0 px-4">
								<ToolEngineList key={selected.id} group={selected} currency={currency} />
							</div>
						</section>
						<section
							aria-labelledby={`${selected.id}-docs-heading`}
							className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
						>
							<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-gray-200 px-4">
								<div className="flex min-h-12 items-center gap-2">
									<BookOpenIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
									<h3 id={`${selected.id}-docs-heading`} className="text-sm font-medium text-gray-900">
										{t('documentation')}
									</h3>
								</div>
								<div role="group" aria-label={t('documentation')} className="flex gap-5">
									{tabs.map((tab) => (
										<button
											key={tab}
											type="button"
											aria-pressed={view === tab}
											onClick={() => setView(tab)}
											className={`inline-flex min-h-12 items-center border-b-2 text-xs ${
												view === tab
													? 'border-gray-900 font-medium text-gray-900'
													: 'border-transparent text-gray-500 hover:text-gray-900'
											}`}
										>
											{t(`tabs.${tab}`)}
										</button>
									))}
								</div>
							</div>
							<div className="min-w-0 p-4">
								{isRestToolId(selected.id) ? (
									<ToolApiReference key={selected.id} toolId={selected.id} baseUrl={proxyBaseUrl} view={view} />
								) : null}
							</div>
						</section>
					</section>
				) : (
					<div className="admin-content-panel rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500">
						{list('noResults')}
					</div>
				)}
			</div>
			<AdminDialog
				open={addressOpen}
				title={t('addressSettings')}
				hint={api('proxyHint')}
				onClose={() => setAddressOpen(false)}
				size="md"
				fallbackFocusRef={searchRef}
			>
				<label htmlFor="rest-proxy-base" className="mb-2 block text-sm font-medium text-gray-700">
					{api('proxyBase')}
				</label>
				<input
					id="rest-proxy-base"
					type="url"
					value={proxyBaseUrl}
					placeholder="https://gateway.example.com"
					onChange={(e) => proxyConnection.setValue(e.target.value)}
					onBlur={proxyConnection.commit}
					aria-invalid={proxyInvalid}
					aria-describedby="rest-proxy-hint"
					className={`h-10 w-full min-w-0 rounded-lg border bg-white px-3 font-mono text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-100 ${
						proxyInvalid ? 'border-red-300' : 'border-gray-200'
					}`}
				/>
				<ProxyConnectionHint
					source={proxyConnection.source}
					canReset={proxyConnection.canReset}
					onReset={proxyConnection.reset}
				/>
				<p id="rest-proxy-hint" className={`mt-2 text-xs leading-5 ${proxyInvalid ? 'text-red-600' : 'text-gray-500'}`}>
					{proxyInvalid ? api('invalidBase') : api('authHint')}
				</p>
			</AdminDialog>
		</section>
	);
}

function ToolEngineList({ group, currency }: { group: ToolProviderGroup; currency: string }) {
	const t = useTranslations('tools.serviceList');
	const ui = useTranslations('tools.ui');
	const badges = useTranslations('tools.providerCards');
	const prices = useTranslations('tools.unitPrices');
	const locale = useLocale();
	const usageName = useId();
	const detailsId = useId();
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const toggleDetails = (id: string) => setExpandedId((current) => (current === id ? null : id));
	const money = (value: string) => {
		const amount = parseDraftMoney(value);
		return amount == null ? '—' : formatGatewayMoneyCompact(amount, currency);
	};
	const multiplier = (value: string, standard: string) => {
		const factor = priceMultiplier(value, standard);
		return factor == null
			? null
			: `×${new Intl.NumberFormat(locale, {
					maximumSignificantDigits: 6,
			  }).format(factor)}`;
	};
	return (
		<div className={styles.container}>
			<div className={`${styles.row} ${styles.heading} border-b border-gray-100 py-3 text-xs text-gray-500`}>
				<span>
					{t('engines')} <span className="ml-2 font-mono text-gray-400">{currency}</span>
				</span>
				<span>{t('usageStatus')}</span>
				{(['standard', 'charged', 'metered'] as const).map((kind) => (
					<span key={kind} className="text-right">
						{prices(kind)}
					</span>
				))}
				<span className="text-right">{t('actions')}</span>
			</div>
			<div className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 text-xs text-gray-500">
				<span>{t('currency', { currency })}</span>
			</div>
			<fieldset>
				<legend className="sr-only">{t('usageStatus')}</legend>
				<ul className="divide-y divide-gray-100" aria-label={t('enginesForTool', { name: group.label })}>
					{group.items.map((item) => {
						const flags = item.status;
						const parts = getPriceSummaryParts(item.savedPrices);
						const ready = item.savedConfigured && flags.isImplemented;
						const loss = Number(parts.charged) < Number(parts.metered);
						const open = () => group.onSelect(item.id);
						const blocked = providerActivationBlock(item);
						const switching = group.activatingId === item.id;
						const expanded = expandedId === item.id;
						const panelId = `${detailsId}-${item.id}`;
						return (
							<li key={item.id} data-tool={group.id} data-provider={item.id} className="relative">
								<div
									role="presentation"
									onClick={(event) => {
										if (
											!(event.target instanceof Element) ||
											event.target.closest('button,input,label,a,select,textarea')
										)
											return;
										toggleDetails(item.id);
									}}
									className={`${
										styles.row
									} relative cursor-pointer items-center py-4 transition-colors hover:bg-gray-50 ${
										flags.isActive ? 'bg-emerald-50/30' : ''
									}`}
								>
									{flags.isActive ? (
										<span className="absolute inset-y-3 -left-4 w-0.5 rounded-r bg-emerald-500" aria-hidden="true" />
									) : null}
									<div className={`${styles.provider} min-w-0`}>
										<button
											type="button"
											aria-expanded={expanded}
											aria-controls={panelId}
											aria-label={t('engineDetails', { name: item.label })}
											onClick={() => toggleDetails(item.id)}
											className="flex w-full min-w-0 items-start gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
										>
											<ChevronRightIcon
												className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform duration-150 motion-reduce:transition-none ${
													expanded ? 'rotate-90' : ''
												}`}
												aria-hidden="true"
											/>
											<span className="min-w-0">
												<span className="block text-sm font-medium text-gray-900">{item.label}</span>
												<span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
													<span className="inline-flex items-center gap-1">
														<KeyIcon className="h-3.5 w-3.5" aria-hidden="true" />
														{t(item.savedConfigured ? 'credentialsSaved' : 'credentialsMissing')}
													</span>
													{flags.isDirty ? <span className="text-amber-700">· {badges('unsaved')}</span> : null}
												</span>
											</span>
										</button>
									</div>
									<div className={styles.status}>
										<label
											title={
												flags.isActive
													? t('usageSelectionHint')
													: blocked
													? t(`activationBlocked.${blocked}`)
													: t('activateSavedHint')
											}
											className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs ${
												flags.isActive
													? 'text-emerald-700'
													: blocked
													? 'cursor-not-allowed text-gray-400'
													: 'cursor-pointer text-gray-600 hover:bg-gray-100'
											}`}
										>
											<input
												type="radio"
												name={usageName}
												value={item.id}
												checked={flags.isActive}
												disabled={group.busy || (!flags.isActive && blocked != null)}
												aria-label={t('enableEngine', { name: item.label })}
												onChange={() => group.onActivate(item.id)}
												className="h-4 w-4 shrink-0 accent-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed"
											/>
											<span className="whitespace-nowrap">
												{switching
													? t('switching')
													: flags.isActive
													? t('inUse')
													: !flags.isImplemented
													? t('unavailable')
													: ready
													? t('standby')
													: t('needsSetup')}
											</span>
										</label>
									</div>
									{(['standard', 'charged', 'metered'] as const).map((kind) => {
										const factor = kind === 'standard' ? null : multiplier(parts[kind], parts.standard);
										return (
											<div key={kind} className={`${styles.price} min-w-0 text-xs`}>
												<span className={`${styles.priceLabel} mb-1 block text-gray-500`}>{prices(kind)}</span>
												<div className={`${styles.amount} flex flex-wrap items-baseline gap-x-2 gap-y-1`}>
													<span
														className={`font-mono text-sm font-medium tabular-nums ${
															ready ? 'text-gray-900' : 'text-gray-500'
														}`}
													>
														{money(parts[kind])}
													</span>
													{factor ? (
														<span
															title={ui('multiplierHint')}
															className="inline-flex shrink-0 items-center rounded-md bg-blue-50 px-1.5 font-mono text-xs font-medium leading-5 tabular-nums text-blue-700"
														>
															{factor}
														</span>
													) : null}
												</div>
												{kind === 'standard' ? (
													<span className="mt-1 block text-gray-400">{item.savedUnitLabel ?? group.unitLabel}</span>
												) : null}
												{kind === 'metered' && loss ? (
													<span className="mt-1 block text-amber-700">{badges('lossPricing')}</span>
												) : null}
											</div>
										);
									})}
									<div className={`${styles.actions} flex items-center justify-end`}>
										<button
											type="button"
											disabled={group.busy}
											aria-label={t('configureEngine', { name: item.label })}
											aria-haspopup="dialog"
											onClick={(event) => {
												event.currentTarget.focus();
												open();
											}}
											className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-40"
										>
											<AdjustmentsHorizontalIcon className="h-4 w-4" aria-hidden="true" />
											{t('configure')}
										</button>
									</div>
								</div>
								<section
									id={panelId}
									hidden={!expanded}
									aria-label={t('engineDetails', { name: item.label })}
									className="border-t border-gray-100 bg-gray-50/60 px-4 py-4 sm:pl-6"
								>
									<ToolEngineDetails toolId={group.id} providerId={item.id} />
								</section>
							</li>
						);
					})}
				</ul>
			</fieldset>
			{group.feedback ? (
				<p
					role={group.feedback.kind === 'error' ? 'alert' : 'status'}
					className={`border-t border-gray-100 py-3 text-xs ${
						group.feedback.kind === 'error' ? 'text-red-600' : 'text-emerald-700'
					}`}
				>
					{group.feedback.message}
				</p>
			) : null}
		</div>
	);
}
