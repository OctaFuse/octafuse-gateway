'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { PlusIcon, ClockIcon, ServerStackIcon, CodeBracketIcon, LinkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
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
	const [guideScope, setGuideScope] = useState('');
	const [guideAuth, setGuideAuth] = useState<McpConnectAuth>('key');
	const proxyBaseUrl = useSyncExternalStore(subscribeProxyUrl, proxyUrlSnapshot, () => '');
	const refreshProxyBaseUrl = () => window.dispatchEvent(new Event(PROXY_URL_CHANGED));
	const [section, setSection] = useState<'services' | 'clients'>('services');
	const sections = [
		{ id: 'services', icon: ServerStackIcon, label: t('sections.services') },
		{ id: 'clients', icon: LinkIcon, label: t('sections.clients') },
	] as const;

	function selectSection(next: 'services' | 'clients') {
		setSection(next);
		window.history.replaceState(
			window.history.state,
			'',
			`${window.location.pathname}${window.location.search}${next === 'clients' ? '#mcp-panel-clients' : ''}`
		);
	}

	useEffect(() => {
		const revealHashTarget = () => {
			if (['#mcp-panel-clients', '#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)) {
				setSection('clients');
			}
		};
		revealHashTarget();
		window.addEventListener('hashchange', revealHashTarget);
		return () => window.removeEventListener('hashchange', revealHashTarget);
	}, []);

	useEffect(() => {
		if (
			section === 'clients' &&
			['#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)
		) {
			document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
		}
	}, [section]);

	const currency = billing.loading ? '—' : billing.currency;
	return (
		<div className="admin-content-workspace content-tone-tools min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<AdminPageTitle>{t('title')}</AdminPageTitle>
					<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Link
						href="/gateway/tools/invocations?source=mcp"
						className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50"
					>
						<ClockIcon className="h-4 w-4" aria-hidden="true" />
						{t('ui.invocations')}
					</Link>
					{section === 'services' ? (
						<button
							type="button"
							disabled={state.busy}
							onClick={() => {
								selectSection('services');
								state.openCreate();
							}}
							className="inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-50"
						>
							<PlusIcon className="h-4 w-4" aria-hidden="true" />
							{t('add')}
						</button>
					) : null}
				</div>
			</div>
			<div
				role="tablist"
				aria-label={t('sections.label')}
				className="admin-detail-tabs mb-6 flex flex-wrap gap-1"
			>
				{sections.map(({ id, label, icon: Icon }, index) => (
					<button
						key={id}
						id={`mcp-tab-${id}`}
						type="button"
						role="tab"
						aria-selected={section === id}
						aria-controls={`mcp-panel-${id}`}
						tabIndex={section === id ? 0 : -1}
						onClick={() => selectSection(id)}
						onKeyDown={(event) => {
							let nextIndex: number;
							switch (event.key) {
								case 'ArrowRight':
									nextIndex = (index + 1) % sections.length;
									break;
								case 'ArrowLeft':
									nextIndex = (index + sections.length - 1) % sections.length;
									break;
								case 'Home':
									nextIndex = 0;
									break;
								case 'End':
									nextIndex = sections.length - 1;
									break;
								default:
									return;
							}
							event.preventDefault();
							const next = sections[nextIndex].id;
							selectSection(next);
							document.getElementById(`mcp-tab-${next}`)?.focus();
						}}
						className={`inline-flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${
							section === id
								? 'border-gray-900 text-gray-900'
								: 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
						}`}
					>
						<Icon className="h-4 w-4" aria-hidden="true" />
						{label}
					</button>
				))}
			</div>
			<div
				id="mcp-panel-services"
				role="tabpanel"
				aria-labelledby="mcp-tab-services"
				hidden={section !== 'services'}
				tabIndex={0}
			>
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
			<div
				id="mcp-panel-clients"
				role="tabpanel"
				aria-labelledby="mcp-tab-clients"
				hidden={section !== 'clients'}
				tabIndex={0}
			>
				<div className="mb-6 grid gap-4 xl:grid-cols-2">
					<section
						className="admin-content-panel rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
						aria-labelledby="mcp-client-access-title"
					>
						<h2 id="mcp-client-access-title" className="text-base font-medium text-gray-900">
							{t('clientAccess.title')}
						</h2>
						<p className="mt-1 text-sm leading-6 text-gray-500">{t('clientAccess.description')}</p>
						<div className="mt-4 flex flex-wrap gap-3">
							<button
								type="button"
								onClick={() => {
									setGuideScope('');
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
							setGuideScope('');
							setGuideAuth('oauth');
							setGuideOpen(true);
						}}
					/>
				</div>
				<OAuthAccessTokensPanel />
			</div>
			<McpServerDrawer
				proxyBaseUrl={proxyBaseUrl}
				onConnectGuide={() => {
					setGuideScope(state.detail?.server.slug ?? '');
					setGuideAuth('key');
					setGuideOpen(true);
				}}
				currency={currency}
				key={state.selectedId ?? 'closed'}
				open={state.selectedId != null && state.formMode == null && catalogScope == null && !guideOpen}
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
					initialSlug={guideScope}
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
