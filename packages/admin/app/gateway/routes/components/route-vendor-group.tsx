'use client';

import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { getModelVendorLabel } from '@/lib/model-vendor';
import { useTranslations } from 'next-intl';
import type { GatewayModel } from '@/lib/types';
import type { RouteListRow } from '../types';
import type { RouteModelGroup } from '../route-utils';
import { RouteModelCard } from './route-model-card';

type Props = {
	vendor: string;
	cards: RouteModelGroup[];
	showHeader: boolean;
	vendorGroupIdx: number;
	modelMeta: Map<string, GatewayModel>;
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

export function RouteVendorGroup(props: Props) {
	const {
		vendor,
		cards,
		showHeader,
		vendorGroupIdx,
		modelMeta,
		copiedModelId,
		togglingId,
		onCopyModelId,
		onCreate,
		onEdit,
		onEditModel,
		onToggleStatus,
		onOpenStickyDialog,
	} = props;

	const t = useTranslations('routes.vendor');

	return (
		<section className="min-w-0">
			{showHeader ? (
				<div
					className={
						(vendorGroupIdx > 0 ? 'border-t border-gray-200/80 pt-5 ' : '') +
						'mb-3 flex items-center justify-between gap-3'
					}
				>
					<div className="flex min-w-0 items-center gap-2.5">
						<ModelVendorIcon vendor={vendor} size="default" />
						<div className="min-w-0">
							<h3 className="truncate text-sm font-semibold text-gray-900">
								{getModelVendorLabel(vendor)}
							</h3>
							<p className="text-xs text-gray-500">{t('label')}</p>
						</div>
					</div>
					<span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium tabular-nums text-gray-600 ring-1 ring-inset ring-gray-200">
						{cards.length === 1
							? t('modelCount', { count: cards.length })
							: t('modelCountPlural', { count: cards.length })}
					</span>
				</div>
			) : null}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 xl:grid-cols-3 xl:gap-6 2xl:grid-cols-4">
				{cards.map((card) => (
					<RouteModelCard
						key={card.model_id}
						card={card}
						meta={modelMeta.get(card.model_id)}
						copiedModelId={copiedModelId}
						togglingId={togglingId}
						onCopyModelId={onCopyModelId}
						onCreate={onCreate}
						onEdit={onEdit}
						onEditModel={onEditModel}
						onToggleStatus={onToggleStatus}
						onOpenStickyDialog={onOpenStickyDialog}
					/>
				))}
			</div>
		</section>
	);
}
