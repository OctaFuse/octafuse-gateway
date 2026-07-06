'use client';

import { LinkIcon } from '@heroicons/react/24/outline';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { resolveStickyRouteRule } from '@octafuse/core/db/model-sticky-config';
import { protocolBadgeClass, splitRoutesByProtocolAndRouteGroup } from '../route-utils';
import { ROUTE_GROUP_CARD_BADGE_CLASS } from '../types';
import type { RouteListRow } from '../types';
import { RouteListItem } from './route-list-item';

type Props = {
	groupRoutes: RouteListRow[];
	modelId: string;
	modelTitle: string;
	stickyConfig: string | null | undefined;
	togglingId: string | null;
	onEdit: (route: RouteListRow) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStickyDialog: (
		modelId: string,
		modelTitle: string,
		protocol: string,
		protocolLabel: string,
		group: string
	) => void;
};

export function RouteProtocolSections(props: Props) {
	const {
		groupRoutes,
		modelId,
		modelTitle,
		stickyConfig,
		togglingId,
		onEdit,
		onToggleStatus,
		onOpenStickyDialog,
	} = props;

	const routeSections = splitRoutesByProtocolAndRouteGroup(groupRoutes);

	return (
		<>
			{routeSections.map((section, sectionIdx) => (
				<div key={section.key} className={sectionIdx > 0 ? 'border-t border-gray-200/80' : ''}>
					<div
						className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-1.5 transition-colors group-hover:bg-blue-50/40 group-focus-within:bg-blue-50/40"
						role="presentation"
					>
						<div
							className="flex min-w-0 flex-1 items-center gap-2"
							title={`upstream_protocol: ${section.protocol} · route_group: ${section.group}`}
						>
							<span
								className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset ${protocolBadgeClass(section.protocol)}`}
							>
								<UpstreamProtocolBrandIcon protocol={section.protocol} />
								{section.protocolLabel}
							</span>
							<span
								className={`inline-flex min-w-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 ${ROUTE_GROUP_CARD_BADGE_CLASS}`}
							>
								<span className="truncate">{section.group}</span>
							</span>
						</div>
						{(() => {
							const stickyRule = resolveStickyRouteRule(stickyConfig ?? null, section.protocol, section.group);
							return (
								<button
									type="button"
									onClick={() =>
										onOpenStickyDialog(
											modelId,
											modelTitle,
											section.protocol,
											section.protocolLabel,
											section.group
										)
									}
									className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4 ring-1 ring-inset transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
										stickyRule
											? 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100'
											: 'bg-white text-gray-400 ring-gray-200 hover:bg-gray-100 hover:text-gray-600'
									}`}
									title={
										stickyRule
											? `Sticky key routing on · idle TTL ${stickyRule.ttlSeconds}s · short wait ${stickyRule.shortWaitMs}ms (click to configure)`
											: 'Sticky key routing off (click to configure)'
									}
								>
									<LinkIcon className="h-3 w-3" />
									{stickyRule ? `Sticky ${stickyRule.ttlSeconds}s` : 'Sticky off'}
								</button>
							);
						})()}
					</div>
					<ul className="flex flex-col divide-y divide-gray-100">
						{section.routes.map((route) => (
							<RouteListItem
								key={route.id}
								route={route}
								togglingId={togglingId}
								onEdit={onEdit}
								onToggleStatus={onToggleStatus}
							/>
						))}
					</ul>
				</div>
			))}
		</>
	);
}
