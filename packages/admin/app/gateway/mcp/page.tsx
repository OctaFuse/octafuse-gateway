'use client';

/**
 * MCP 服务：列表审核远程目录，详情在右侧抽屉，新建和编辑用弹窗。
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { McpServerDrawer } from './components/mcp-server-drawer';
import { McpServerFormModal } from './components/mcp-server-form-modal';
import { McpServerTable } from './components/mcp-server-table';
import { useMcpServersState } from './use-mcp-servers-state';

export default function McpServersPage() {
	const t = useTranslations('mcp');
	const state = useMcpServersState();

	return (
		<div className="min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">{t('subtitle')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Link href="/gateway/tools/invocations?source=mcp" className="text-sm font-medium text-blue-600 hover:underline">
						{t('viewInvocations')}
					</Link>
					<button type="button" onClick={state.openCreate} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
						{t('add')}
					</button>
				</div>
			</div>
			<McpServerTable
				servers={state.servers}
				busy={state.busy}
				onOpen={(id) => state.setSelectedId(id)}
				onSync={(id) => {
					state.setSelectedId(id);
					void state.sync(id);
				}}
				onEdit={(server) => {
					state.setSelectedId(server.id);
					void state.openEdit(server);
				}}
			/>
			<McpServerDrawer
				open={state.selectedId != null}
				detail={state.detail}
				tab={state.tab}
				busy={state.busy}
				revealed={state.revealed}
				onTab={state.setTab}
				onClose={() => state.setSelectedId(null)}
				onToggleServer={() => void state.toggleServer()}
				onTest={() => void state.test()}
				onSync={() => void state.sync()}
				onReveal={() => void state.reveal()}
				onToggleItem={(id, enabled) => void state.setItemStatus([id], enabled ? 'enabled' : 'disabled')}
				onEnableNew={() => void state.setItemStatus(
					state.detail?.items.filter((item) => item.kind === state.tab && item.reviewState === 'new' && item.status === 'disabled').map((item) => item.id) ?? [],
					'enabled',
				)}
				onAccept={(id) => void state.accept(id)}
				onPatchItem={state.patchItem}
				onSavePrice={(item, clear) => void state.savePrice(item, clear)}
				onDelete={() => void state.removeServer()}
			/>
			{state.formMode ? (
				<McpServerFormModal
					mode={state.formMode}
					form={state.form}
					busy={state.busy}
					urlMasked={state.detail?.server.urlMasked}
					onChange={state.setForm}
					onClose={() => state.setFormMode(null)}
					onSubmit={() => void state.submitForm()}
				/>
			) : null}
		</div>
	);
}
