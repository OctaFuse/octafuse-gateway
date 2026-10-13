'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
	PlusIcon,
	ClockIcon,
	ServerStackIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	CodeBracketIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { McpServerDrawer } from './components/mcp-server-drawer';
import { McpServerFormModal } from './components/mcp-server-form-modal';
import { McpServerTable } from './components/mcp-server-table';
import { useMcpServersState } from './use-mcp-servers-state';
import { McpCatalogTestModal } from './components/mcp-catalog-test-modal';

export default function McpServersPage() {
	const t = useTranslations('mcp');
	const state = useMcpServersState();
	const billing = useBillingCurrency();
	const [catalogScope, setCatalogScope] = useState<string | null>(null);
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
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						disabled={state.busy}
						onClick={() => setCatalogScope('')}
						className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
					>
						<CodeBracketIcon className="h-4 w-4" aria-hidden="true" />
						{t('catalogTest.title')}
					</button>
					<Link
						href="/gateway/tools/invocations?source=mcp"
						className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
					>
						{t('viewInvocations')}
					</Link>
					<button
						type="button"
						disabled={state.busy}
						onClick={state.openCreate}
						className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
						{t('add')}
					</button>
				</div>
			</div>
			<div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
				{metrics.map(({ label, value, icon: Icon, tone }) => (
					<div
						key={label}
						className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-4 sm:px-5"
					>
						<span className={`rounded-lg p-2.5 ${tone}`}>
							<Icon className="h-5 w-5" aria-hidden="true" />
						</span>
						<div>
							<p className="text-xs text-gray-500">{label}</p>
							<p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
								{(state.listLoading || state.listError) && !state.servers.length ? '—' : value}
							</p>
						</div>
					</div>
				))}
			</div>
			<McpServerTable
				currency={currency}
				servers={state.servers}
				busy={state.busy}
				loading={state.listLoading}
				error={state.listError}
				onOpen={state.selectServer}
				onCreate={state.openCreate}
				onRefresh={() => void state.loadList()}
			/>
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
					onClose={() => setCatalogScope(null)}
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
