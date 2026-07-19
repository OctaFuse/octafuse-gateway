'use client';

import { ClipboardDocumentIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/outline';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { useTranslations } from 'next-intl';
import type { GatewayModel } from '@/lib/types';
import { tagBadgeClass } from '../../models/model-utils';
import type { RouteListRow } from '../types';
import type { RouteModelGroup } from '../route-utils';
import { parseModelTagsList } from '../route-utils';
import { RouteProtocolSections } from './route-protocol-section';

type Props = {
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: (modelId: string) => void;
	onEdit: (route: RouteListRow) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStickyDialog: (
		modelId: string,
		modelTitle: string,
		protocol: string,
		protocolLabel: string,
		group: string
	) => void;
};

export function RouteModelCard(props: Props) {
	const {
		card,
		meta,
		copiedModelId,
		togglingId,
		onCopyModelId,
		onCreate,
		onEdit,
		onEditModel,
		onToggleStatus,
		onOpenStickyDialog,
	} = props;
	const t = useTranslations('routes.card');
	const tModelsCard = useTranslations('models.card');
	const { model_id, title, groupRoutes, activeCount } = card;
	const isImage = meta ? isImageGenerationModel(meta) : false;
	const contextStr = formatCompactTokens(meta?.context_window);
	const maxStr = formatCompactTokens(meta?.max_tokens);
	const modelStatsTitle = isImage
		? t('imageModelHint')
		: t('contextMaxOutput', { context: contextStr, max: maxStr });
	const modelStatsLine = isImage
		? t('imageModelHint')
		: t('contextLine', { context: contextStr, max: maxStr });
	const tags = parseModelTagsList(meta);
	const tagShown = tags.slice(0, 6);
	const tagExtra = tags.length - tagShown.length;

	return (
		<div className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-lg hover:shadow-blue-100/70 hover:ring-1 hover:ring-blue-200 focus-within:border-blue-400 focus-within:bg-blue-50/30 focus-within:shadow-lg focus-within:ring-2 focus-within:ring-blue-500 active:translate-y-0">
			<div className="flex items-start justify-between gap-2 border-b border-gray-100 bg-white px-4 py-3 transition-colors group-hover:bg-blue-50/30 group-focus-within:bg-blue-50/30">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<h4 className="min-w-0 truncate text-sm font-semibold leading-snug text-gray-900">
							<button
								type="button"
								onClick={() => onEditModel(model_id)}
								className="max-w-full truncate text-left text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue-500"
								title={t('editModelTitle', { title })}
							>
								{title}
							</button>
						</h4>
						<button
							type="button"
							onClick={() => onEditModel(model_id)}
							className="shrink-0 rounded-md p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
							title={t('editModel', { title })}
							aria-label={t('editModelAria', { title })}
						>
							<PencilSquareIcon className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => void onCopyModelId(model_id)}
							className={`shrink-0 rounded-md p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
								copiedModelId === model_id
									? 'text-green-600 hover:bg-green-50 hover:text-green-700'
									: 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
							}`}
							title={
								copiedModelId === model_id
									? t('copiedModelId')
									: t('copyModelId', { id: model_id })
							}
							aria-label={t('copyModelIdAria', { id: model_id })}
						>
							<ClipboardDocumentIcon className="h-4 w-4" />
						</button>
					</div>
					<div className="mt-0.5 flex min-w-0 items-center gap-1.5">
						<p className="min-w-0 truncate text-[11px] text-gray-500" title={modelStatsTitle}>
							{modelStatsLine}
						</p>
						{copiedModelId === model_id ? (
							<span className="shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-green-700 ring-1 ring-inset ring-green-200">
								{t('copied')}
							</span>
						) : null}
					</div>
					<div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1">
						{tagShown.length > 0 ? (
							<>
								{tagShown.map((tag) => (
									<span
										key={tag}
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}
										title={t('modelTagTitle', { tag })}
									>
										{tag}
									</span>
								))}
								{tagExtra > 0 ? (
									<span className="self-center text-[10px] text-gray-400">+{tagExtra}</span>
								) : null}
							</>
						) : (
							<span className="text-[10px] text-gray-400">{tModelsCard('noTags')}</span>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						onClick={() => onCreate(model_id)}
						className="rounded-md p-1 text-blue-600 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
						title={t('newRouteFor', { title })}
						aria-label={t('newRouteFor', { title })}
					>
						<PlusIcon className="h-5 w-5" />
					</button>
					<span
						className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${
							activeCount === 0
								? 'bg-red-50 text-red-700 ring-red-200'
								: 'bg-green-50 text-green-700 ring-green-200'
						}`}
						title={t('activeTotalRoutes', { active: activeCount, total: groupRoutes.length })}
					>
						{activeCount}/{groupRoutes.length}
					</span>
				</div>
			</div>
			{groupRoutes.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-4 py-6 text-center">
					<div>
						<p className="text-sm text-gray-600">{t('noRoutesYet')}</p>
						<p className="mt-1 text-xs text-gray-500">{t('clickToAdd')}</p>
					</div>
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					<RouteProtocolSections
						groupRoutes={groupRoutes}
						modelId={model_id}
						modelTitle={title}
						stickyConfig={meta?.sticky_config}
						togglingId={togglingId}
						onEdit={onEdit}
						onToggleStatus={onToggleStatus}
						onOpenStickyDialog={onOpenStickyDialog}
					/>
				</div>
			)}
		</div>
	);
}
