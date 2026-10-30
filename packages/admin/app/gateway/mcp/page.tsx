'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
	PlusIcon,
	ClockIcon,
	ServerStackIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	CodeBracketIcon,
	LinkIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { McpServerDrawer } from './components/mcp-server-drawer';
import { McpServerFormModal } from './components/mcp-server-form-modal';
import { McpServerTable } from './components/mcp-server-table';
import { useMcpServersState } from './use-mcp-servers-state';
import { McpCatalogTestModal } from './components/mcp-catalog-test-modal';
import { McpConnectGuideModal, type McpConnectAuth } from './components/mcp-connect-guide-modal';
import { McpOAuthSettings } from './components/mcp-oauth-settings';
import { OAuthAccessTokensPanel } from './components/oauth-access-tokens-panel';
import { readSavedMcpProxyUrl } from './mcp-connect-guide-utils';
import { mcpProxyBaseUrl } from './mcp-catalog-test-utils';

const PROXY_URL_CHANGED = 'mcp-proxy-url-changed';

function subscribeProxyUrl(onChange: () => void) {
	window.addEventListener('storage', onChange);
	window.addEventListener(PROXY_URL_CHANGED, onChange);
	return () => {
		window.removeEventListener('storage', onChange);
		window.removeEventListener(PROXY_URL_CHANGED, onChange);
	};
}

function proxyUrlSnapshot() {
	return mcpProxyBaseUrl(readSavedMcpProxyUrl()) ?? '';
}

export default function McpServersPage() {
	const t = useTranslations('mcp');
	const state = useMcpServersState();
	const billing = useBillingCurrency();
	const [catalogScope, setCatalogScope] = useState<string | null>(null);
	const [guideOpen, setGuideOpen] = useState(false);
	const [guideAuth, setGuideAuth] = useState<McpConnectAuth>('key');
	const proxyBaseUrl = useSyncExternalStore(subscribeProxyUrl, proxyUrlSnapshot, () => '');
	const refreshProxyBaseUrl = () => window.dispatchEvent(new Event(PROXY_URL_CHANGED));
	const [section, setSection] = useState<'services' | 'clients'>('services');
	const sections = [
		{ id: 'services', label: t('sections.services') },
		{ id: 'clients', label: t('sections.clients') },
	] as const;

	useEffect(() => {
		const revealHashTarget = () => {
			if (['#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)) {
				setSection('clients');
			}
		};
		revealHashTarget();
		window.addEventListener('hashchange', revealHashTarget);
		return () => window.removeEventListener('hashchange', revealHashTarget);
	}, []);

	useEffect(() => {
		if (section === 'clients' && ['#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)) {
			document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
		}
	}, [section]);

	const currency = billing.loading ? '—' : billing.currency;
	const metrics = [
		{
			label: t('totalServers'),
			value: state.servers.length,
			icon: ServerStackIcon,
			tone: 'bg-gray-100 text-gray-500',
		},
		{
			label: t('enabledItems'),
			value: state.servers.filter((s) => s.status === 'active').reduce((sum, s) => sum + s.enabledCount, 0),
			icon: CheckCircleIcon,
			tone: 'bg-emerald-50 text-emerald-600',
		},
		{
			label: t('pendingCount'),
			value: state.servers.reduce((sum, s) => sum + s.pendingCount, 0),
			icon: ClockIcon,
			tone: 'bg-amber-50 text-amber-600',
		},
		{
			label: t('syncError'),
			value: state.servers.filter((s) => s.lastSyncError).length,
			icon: ExclamationTriangleIcon,
			tone: 'bg-red-50 text-red-500',
		},
	];
	return (
		<div className="min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{t('title')}</h1>
					<p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">{t('subtitle')}</p>
				</div>
				<button
					type="button"
					disabled={state.busy}
					onClick={() => {
						setSection('services');
						state.openCreate();
					}}
					className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
				>
					<PlusIcon className="h-4 w-4" aria-hidden="true" />
					{t('add')}
				</button>
			</div>
			<div role="tablist" aria-label={t('sections.label')} className="mb-6 flex gap-6 border-b border-gray-200">
				{sections.map(({ id, label }, index) => (
					<button
						key={id}
						id={`mcp-tab-${id}`}
						type="button"
						role="tab"
						aria-selected={section === id}
						aria-controls={`mcp-panel-${id}`}
						tabIndex={section === id ? 0 : -1}
						onClick={() => setSection(id)}
						onKeyDown={(event) => {
							let nextIndex: number;
							switch (event.key) {
								case 'ArrowRight': nextIndex = (index + 1) % sections.length; break;
								case 'ArrowLeft': nextIndex = (index + sections.length - 1) % sections.length; break;
								case 'Home': nextIndex = 0; break;
								case 'End': nextIndex = sections.length - 1; break;
								default: return;
							}
							event.preventDefault();
							const next = sections[nextIndex].id;
							setSection(next);
							document.getElementById(`mcp-tab-${next}`)?.focus();
						}}
						className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${section === id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}`}
					>
						{label}
					</button>
				))}
			</div>
			<div id="mcp-panel-services" role="tabpanel" aria-labelledby="mcp-tab-services" hidden={section !== 'services'} tabIndex={0}>
				<div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
					{metrics.map(({ label, value, icon: Icon, tone }) => (
						<div key={label} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4 sm:px-5">
							<span className={`rounded-lg p-2.5 ${tone}`}>
								<Icon className="h-5 w-5" aria-hidden="true" />
							</span>
							<div className="min-w-0">
								<p className="text-xs text-gray-500">{label}</p>
								<p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
									{(state.listLoading || state.listError) && !state.servers.length ? '—' : value}
								</p>
							</div>
						</div>
					))}
				</div>
				<McpServerTable
					proxyBaseUrl={proxyBaseUrl}
					currency={currency}
					servers={state.servers}
					busy={state.busy}
					loading={state.listLoading}
					error={state.listError}
					onOpen={state.selectServer}
					onCreate={state.openCreate}
					onRefresh={() => void state.loadList()}
				/>
			</div>
			{/* Keep both panels mounted so switching tabs preserves filters and unsaved OAuth settings. */}
			<div id="mcp-panel-clients" role="tabpanel" aria-labelledby="mcp-tab-clients" hidden={section !== 'clients'} tabIndex={0}>
				<section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="mcp-client-access-title">
					<h2 id="mcp-client-access-title" className="text-base font-semibold text-gray-900">{t('clientAccess.title')}</h2>
					<p className="mt-1 text-sm leading-6 text-gray-500">{t('clientAccess.description')}</p>
					<div className="mt-4 flex flex-wrap gap-3">
						<button
							type="button"
							onClick={() => {
								setGuideAuth('key');
								setGuideOpen(true);
							}}
							className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
						>
							<LinkIcon className="h-4 w-4" aria-hidden="true" />
							{t('connectGuide.button')}
						</button>
						<button
							type="button"
							disabled={state.busy}
							onClick={() => setCatalogScope('')}
							className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
						>
							<CodeBracketIcon className="h-4 w-4" aria-hidden="true" />
							{t('catalogTest.title')}
						</button>
					</div>
				</section>
				<McpOAuthSettings
					onOpenGuide={() => {
						setGuideAuth('oauth');
						setGuideOpen(true);
					}}
				/>
				<OAuthAccessTokensPanel />
			</div>
			<McpServerDrawer
				currency={currency}
				key={state.selectedId ?? 'closed'}
				open={state.selectedId != null && state.formMode == null && catalogScope == null}
				detail={state.detail}
				summary={state.servers.find((s) => s.id === state.selectedId)}
				loading={state.detailLoading}
				error={state.detailError}
				tab={state.tab}
				busy={state.busy}
				action={state.action}
				revealed={state.revealed}
				testResult={state.testResult}
				onTab={state.setTab}
				onClose={() => state.selectServer(null)}
				onRetry={() => {
					if (state.selectedId) void state.loadDetail(state.selectedId);
				}}
				onEdit={() => {
					const server = state.detail?.server;
					if (server) state.openEdit(server);
				}}
				onToggleServer={() => void state.toggleServer()}
				onTest={() => void state.test()}
				onCatalogTest={() => {
					const server = state.servers.find((s) => s.id === state.selectedId);
					if (server) setCatalogScope(server.slug);
				}}
				onSync={() => void state.sync()}
				onReveal={() => void state.reveal()}
				onSetItemStatus={state.setItemStatus}
				onAccept={(id) => void state.accept(id)}
				onSavePricing={state.savePricing}
				onDelete={() => void state.removeServer()}
			/>
			{catalogScope !== null ? (
				<McpCatalogTestModal
					servers={state.servers}
					initialSlug={catalogScope}
					onClose={() => {
						setCatalogScope(null);
						refreshProxyBaseUrl();
					}}
				/>
			) : null}
			{guideOpen ? (
				<McpConnectGuideModal
					servers={state.servers}
					initialSlug=""
					initialAuth={guideAuth}
					onClose={() => {
						setGuideOpen(false);
						refreshProxyBaseUrl();
					}}
				/>
			) : null}
			{state.formMode ? (
				<McpServerFormModal
					currency={currency}
					mode={state.formMode}
					form={state.form}
					busy={state.busy}
					urlMasked={state.editingServer?.urlMasked}
					savedHeaderNames={state.editingServer?.authHeaderNames ?? []}
					onChange={state.setForm}
					onClose={() => state.setFormMode(null)}
					onSubmit={() => void state.submitForm()}
				/>
			) : null}
		</div>
	);
}
