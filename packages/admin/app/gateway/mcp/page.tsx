'use client';

import { useProxyBaseUrl } from '@/components/proxy-connection-provider';
import { AdminPageTitle } from '@/components/admin-page-title';

import { Suspense, useEffect, useRef, useState } from 'react';
import { ClockIcon, ServerStackIcon, CodeBracketIcon, LinkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { McpServerWorkspace } from './components/mcp-server-workspace';
import { McpServerDirectory } from './components/mcp-server-directory';
import {
	mcpWorkspaceSearch,
	readMcpWorkspaceLocation,
	type McpWorkspaceView,
	type McpConnectAuth,
} from './mcp-workspace-location';
import { McpServerFormModal } from './components/mcp-server-form-modal';
import { useMcpServersState } from './use-mcp-servers-state';
import { McpCatalogTestModal } from './components/mcp-catalog-test-modal';
import { McpConnectGuide } from './components/mcp-connect-guide';
import { McpOAuthSettings } from './components/mcp-oauth-settings';
import { OAuthAccessTokensPanel } from './components/oauth-access-tokens-panel';
import styles from './mcp-client-workspace.module.css';

function McpServersWorkspace() {
	const searchParams = useSearchParams();
	const t = useTranslations('mcp');
	const state = useMcpServersState();
	const billing = useBillingCurrency();
	const [catalogScope, setCatalogScope] = useState<string | null>(null);
	const [guideScope, setGuideScope] = useState('');
	const [guideAuth, setGuideAuth] = useState<McpConnectAuth>('key');
	const [oauthServer, setOauthServer] = useState<string | undefined>(undefined);
	const proxyBaseUrl = useProxyBaseUrl().url;
	const [section, setSection] = useState<'services' | 'clients'>('services');
	const [view, setView] = useState<McpWorkspaceView>('catalog');
	const [requestedLocation, setRequestedLocation] = useState<ReturnType<typeof readMcpWorkspaceLocation> | null>(null);
	const appliedLocation = useRef<typeof requestedLocation>(null);
	const pendingLocation = useRef<typeof requestedLocation>(null);
	const observedUrl = useRef<string | null>(null);

	// Ignore our own URL updates, but restore state for Next Link navigation as well as browser history.
	function replaceLocation(search: string, hash: string) {
		observedUrl.current = `${search}${hash}`;
		window.history.replaceState(null, '', `${window.location.pathname}${search}${hash}`);
	}
	const sections = [
		{ id: 'services', icon: ServerStackIcon, label: t('sections.services') },
		{ id: 'clients', icon: LinkIcon, label: t('sections.clients') },
	] as const;

	// Pass app-owned history data so Next also updates its cached navigation URL.
	function selectSection(next: 'services' | 'clients') {
		setSection(next);
		replaceLocation(window.location.search, next === 'clients' ? '#mcp-panel-clients' : '');
	}

	useEffect(() => {
		const restoreLocation = () => {
			const url = `${window.location.search}${window.location.hash}`;
			if (observedUrl.current === url) return;
			observedUrl.current = url;
			const location = readMcpWorkspaceLocation(window.location.search, window.location.hash);
			pendingLocation.current = location;
			setRequestedLocation(location);
			setView(location.view);
			setSection(location.section);
			setGuideScope(location.scope);
			setGuideAuth(location.auth);
		};
		restoreLocation();
		window.addEventListener('hashchange', restoreLocation);
		window.addEventListener('popstate', restoreLocation);
		return () => {
			window.removeEventListener('hashchange', restoreLocation);
			window.removeEventListener('popstate', restoreLocation);
		};
	}, [searchParams]);

	const { servers, selectedId, selectServer, listLoading, listError, busy, formMode } = state;
	useEffect(() => {
		if (
			!requestedLocation || pendingLocation.current !== requestedLocation ||
			listLoading || listError || busy || formMode
		) return;
		const requested =
			appliedLocation.current !== requestedLocation
				? servers.find((server) => server.slug === requestedLocation.server)
				: undefined;
		const selected = servers.find((server) => server.id === selectedId);
		const next = requested ?? selected ?? servers[0];
		if (next?.id !== (selectedId ?? undefined)) {
			selectServer(next?.id ?? null);
			return;
		}
		appliedLocation.current = requestedLocation;
	}, [servers, selectedId, selectServer, requestedLocation, listLoading, listError, busy, formMode]);

	useEffect(() => {
		if (
			!requestedLocation || pendingLocation.current !== requestedLocation ||
			appliedLocation.current !== requestedLocation || listLoading || listError
		) return;
		const server = servers.find((entry) => entry.id === selectedId);
		if (selectedId && !server) return;
		const hash = section === 'clients'
			? ['#mcp-panel-clients', '#mcp-client-guide', '#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)
				? window.location.hash
				: '#mcp-panel-clients'
			: '';
		replaceLocation(
			mcpWorkspaceSearch(window.location.search, server?.slug ?? null, view, guideScope, guideAuth),
			hash
		);
	}, [servers, selectedId, view, section, guideScope, guideAuth, requestedLocation, listLoading, listError]);

	useEffect(() => {
		if (section === 'clients' && ['#mcp-client-guide', '#mcp-oauth', '#oauth-access-tokens'].includes(window.location.hash)) {
			document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
		}
	}, [section, requestedLocation]);

	function openClientGuide(scope: string, auth: McpConnectAuth = 'key') {
		setGuideScope(scope);
		setGuideAuth(auth);
		setSection('clients');
		replaceLocation(
			mcpWorkspaceSearch(window.location.search, state.detail?.server.slug ?? null, view, scope, auth),
			'#mcp-client-guide'
		);
		requestAnimationFrame(() => {
			const guide = document.getElementById('mcp-client-guide');
			guide?.focus({ preventScroll: true });
			guide?.scrollIntoView({ block: 'start' });
		});
	}

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
				</div>
			</div>
			<div role="tablist" aria-label={t('sections.label')} className="admin-detail-tabs mb-6 flex flex-wrap gap-1">
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
				<div className="grid min-w-0 items-start gap-4 xl:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[240px_minmax(0,1fr)]">
					<McpServerDirectory
						servers={state.servers}
						selectedId={state.selectedId}
						busy={state.busy}
						loading={state.listLoading}
						error={state.listError}
						onCreate={state.openCreate}
						onSelect={state.selectServer}
						onRefresh={() => {
							void state.loadList();
							if (state.selectedId) void state.loadDetail(state.selectedId);
						}}
					/>
					<div className="min-w-0">
						{state.selectedId ? (
							<McpServerWorkspace
								proxyBaseUrl={proxyBaseUrl}
								currency={currency}
								key={state.selectedId ?? 'empty'}
								section={view}
								onSection={setView}
								detail={state.detail}
								loading={state.detailLoading}
								error={state.detailError}
								tab={state.tab}
								busy={state.busy}
								action={state.action}
								revealed={state.revealed}
								testResult={state.testResult}
								onTab={state.setTab}
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
								onConnectGuide={() => {
									if (state.detail) openClientGuide(state.detail.server.slug);
								}}
								onSync={() => void state.sync()}
								onReveal={() => void state.reveal()}
								onSetItemStatus={state.setItemStatus}
								onAccept={(id) => void state.accept(id)}
								onSavePricing={state.savePricing}
								onDelete={() => void state.removeServer()}
							/>
						) : (
							<div className="admin-content-panel rounded-xl border border-gray-200 bg-white px-6 py-16 text-center">
								<ServerStackIcon className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
								<p className="mt-4 text-sm text-gray-500">
									{t(
										state.listLoading
											? 'workspace.loading'
											: state.servers.length
											? 'workspace.selectService'
											: 'emptyHint'
									)}
								</p>
							</div>
						)}
					</div>
				</div>
			</div>
			{/* Keep both panels mounted so switching tabs preserves filters and unsaved OAuth settings. */}
			<div
				id="mcp-panel-clients"
				className={styles.clients}
				role="tabpanel"
				aria-labelledby="mcp-tab-clients"
				hidden={section !== 'clients'}
				tabIndex={0}
			>
				<div className="mb-4">
					<section
						id="mcp-client-guide"
						tabIndex={-1}
						className="admin-content-panel min-w-0 scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 focus:outline-none sm:p-6"
						aria-labelledby="mcp-client-access-title"
					>
						<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 id="mcp-client-access-title" className="text-base font-medium text-gray-900">
									{t('connectGuide.title')}
								</h2>
								<p className="mt-1 text-sm leading-6 text-gray-500">{t('clientAccess.description')}</p>
							</div>
							<button
								type="button"
								disabled={state.busy}
								onClick={() => setCatalogScope(guideScope)}
								className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
							>
								<CodeBracketIcon className="h-4 w-4" aria-hidden="true" />
								{t('catalogTest.title')}
							</button>
						</div>
						<McpConnectGuide
							servers={state.servers}
							scope={guideScope}
							onScopeChange={setGuideScope}
							auth={guideAuth}
							onAuthChange={setGuideAuth}
							oauthServer={oauthServer}
						/>
					</section>
				</div>
				<div className={styles.authorization}>
					<McpOAuthSettings onSaved={setOauthServer} onOpenGuide={() => openClientGuide(guideScope, 'oauth')} />
					<OAuthAccessTokensPanel active={section === 'clients'} />
				</div>
			</div>
			{catalogScope !== null ? (
				<McpCatalogTestModal
					servers={state.servers}
					initialSlug={catalogScope}
					onClose={() => {
						setCatalogScope(null);
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

export default function McpServersPage() {
	const t = useTranslations('common');
	return (
		<Suspense fallback={<div role="status" className="p-6 text-sm text-gray-500">{t('loading')}</div>}>
			<McpServersWorkspace />
		</Suspense>
	);
}
