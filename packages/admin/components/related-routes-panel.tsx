'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
	ArrowPathIcon,
	ArrowTopRightOnSquareIcon,
	MagnifyingGlassIcon,
	ShareIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { isUpstreamProtocol } from '@/lib/upstream-protocol';
import { endpointFieldsForUpstreamOperation } from '@/app/gateway/providers/provider-endpoint-fields';
import type { RouteListRow } from '@/app/gateway/routes/types';

export type RelatedRoutesState = {
	routes: RouteListRow[];
	loading: boolean;
	error: string;
	ready: boolean;
	isDeleting: boolean;
	reload: () => void;
	remove: (ids: string[]) => Promise<void>;
};

function RouteCapabilityBadges({
	protocol,
	operation,
}: {
	protocol: string;
	operation?: string;
}) {
	const t = useTranslations('providers.modal');
	const fields = endpointFieldsForUpstreamOperation(protocol, operation);
	if (!fields.length) {
		const automatic = !operation?.trim() || operation.trim() === '*';
		return (
			<span className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
				<span className="truncate">
					{automatic ? t('relatedRoutes.autoCapability') : operation}
				</span>
				{automatic ? (
					<InfoHintPopover
						label={t('relatedRoutes.autoCapability')}
						openOnHover
						openOnFocus
						portal
						align="start"
					>
						<p className="leading-5">{t('relatedRoutes.autoCapabilityHint')}</p>
					</InfoHintPopover>
				) : null}
			</span>
		);
	}
	return (
		<div className="mt-1 flex flex-wrap gap-1">
			{fields.map(({ capability, description }) => {
				const name = t(`endpointCapabilityLabels.${description}`);
				return (
					<span
						key={capability}
						className="inline-flex items-center gap-1.5 rounded border border-blue-100 bg-blue-50/70 px-1.5 py-0.5 text-[11px] font-medium leading-4 text-blue-700"
					>
						{name}
						<InfoHintPopover
							label={t('capabilityHelp', { name })}
							openOnHover
							openOnFocus
							portal
							align="start"
						>
							<p className="leading-5">
								{t(`endpointCapabilities.${description}`)}
							</p>
						</InfoHintPopover>
					</span>
				);
			})}
		</div>
	);
}

export function RelatedRoutesPanel({
	state,
	disabled,
	perspective = 'provider',
}: {
	state: RelatedRoutesState;
	perspective?: 'provider' | 'model';
	disabled: boolean;
}) {
	const isModelView = perspective === 'model';
	const t = useTranslations(
		isModelView ? 'models.modal.relatedRoutes' : 'providers.modal.relatedRoutes'
	);
	const tCommon = useTranslations('common');
	const tModal = useTranslations('providers.modal');
	const tUpstream = useTranslations('upstream');
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<string[]>([]);
	const selectAllRef = useRef<HTMLInputElement>(null);
	const normalized = query.trim().toLocaleLowerCase();
	const filtered = state.routes.filter((route) =>
		[
			route.id,
			...(isModelView ? [route.provider_name, route.provider_id] : []),
			route.model_name,
			route.model_id,
			route.provider_model_name,
			route.upstream_protocol,
			route.upstream_operation,
			route.route_group,
			...(isUpstreamProtocol(route.upstream_protocol)
				? [tUpstream(route.upstream_protocol)]
				: []),
			...endpointFieldsForUpstreamOperation(
				route.upstream_protocol,
				route.upstream_operation
			).map(({ description }) =>
				tModal(`endpointCapabilityLabels.${description}`)
			),
			...(!route.upstream_operation?.trim() ||
			route.upstream_operation.trim() === '*'
				? [t('autoCapability')]
				: []),
		].some((value) => value?.toLocaleLowerCase().includes(normalized))
	);
	const selectedIds = selected.filter((id) =>
		state.routes.some((route) => route.id === id)
	);
	const allSelected =
		filtered.length > 0 &&
		filtered.every((route) => selectedIds.includes(route.id));
	useEffect(() => {
		if (selectAllRef.current)
			selectAllRef.current.indeterminate =
				!allSelected &&
				filtered.some((route) => selectedIds.includes(route.id));
	}, [allSelected, filtered, selectedIds]);

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
			<div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
				{state.routes.length > 0 ? (
					<div className="relative min-w-0 flex-1 sm:max-w-sm">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-3 top-2 h-4 w-4 text-gray-400"
							aria-hidden
						/>
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t('search')}
							aria-label={t('search')}
							className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
						/>
					</div>
				) : null}
				{state.ready && state.routes.length > 0 ? (
					<p aria-live="polite" className="text-xs text-gray-500">
						{normalized
							? t('matchedSummary', {
									matched: filtered.length,
									count: state.routes.length,
							  })
							: t('summary', {
									count: state.routes.length,
									active: state.routes.filter(
										(route) => route.status === 'active'
									).length,
							  })}
					</p>
				) : null}
				<div className="ml-auto flex shrink-0 items-center gap-2">
					{selectedIds.length > 0 ? (
						<button
							type="button"
							onClick={() => void state.remove(selectedIds)}
							disabled={disabled || !state.ready}
							className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40"
						>
							<TrashIcon className="h-3.5 w-3.5" aria-hidden />
							{t('deleteSelected', { count: selectedIds.length })}
						</button>
					) : null}
					<button
						type="button"
						onClick={state.reload}
						disabled={disabled || state.loading}
						aria-label={t('refresh')}
						className="rounded-md p-2 text-gray-400 hover:bg-white hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
					>
						<ArrowPathIcon
							className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`}
							aria-hidden
						/>
					</button>
					<InfoHintPopover
						label={t('help')}
						openOnHover
						openOnFocus
						portal
						align="end"
					>
						<p className="leading-5">{t('hint')}</p>
					</InfoHintPopover>
				</div>
			</div>
			{state.error ? (
				<div
					role="alert"
					className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700"
				>
					<p className="font-medium">{t('loadFailed')}</p>
					<p className="mt-1 break-words">{state.error}</p>
					<button
						type="button"
						onClick={state.reload}
						disabled={disabled || state.loading}
						className="mt-3 font-medium underline disabled:opacity-40"
					>
						{t('retry')}
					</button>
				</div>
			) : state.loading ? (
				<p role="status" className="py-16 text-center text-sm text-gray-500">
					{tCommon('loading')}
				</p>
			) : !state.routes.length ? (
				<div className="px-6 py-14 text-center">
					<ShareIcon className="mx-auto h-8 w-8 text-gray-300" aria-hidden />
					<p className="mt-3 text-sm font-medium text-gray-800">{t('empty')}</p>
					<p className="mt-1 text-xs leading-5 text-gray-500">
						{t('emptyHint')}
					</p>
				</div>
			) : (
				<>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] table-fixed text-left text-sm">
							<thead className="border-b border-gray-100 bg-gray-50/50 text-xs text-gray-500">
								<tr>
									<th scope="col" className="w-10 py-2 pl-4 pr-2">
										<input
											ref={selectAllRef}
											type="checkbox"
											aria-label={t('selectAll')}
											checked={allSelected}
											disabled={disabled || !filtered.length}
											className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
											onChange={(event) =>
												setSelected(
													event.target.checked
														? Array.from(
																new Set([
																	...selectedIds,
																	...filtered.map((route) => route.id),
																])
														  )
														: selectedIds.filter(
																(id) =>
																	!filtered.some((route) => route.id === id)
														  )
												)
											}
										/>
									</th>
									<th scope="col" className="px-3 py-2 font-medium">
										{isModelView ? t('provider') : t('model')}
									</th>
									<th scope="col" className="w-[28%] px-3 py-2 font-medium">
										{t('protocol')}
									</th>
									<th scope="col" className="w-24 px-3 py-2 font-medium">
										{t('group')}
									</th>
									{isModelView ? (
										<th scope="col" className="w-24 px-3 py-2 font-medium">
											{t('priority')} / {t('weight')}
										</th>
									) : null}
									<th scope="col" className="w-24 px-3 py-2 font-medium">
										{t('status')}
									</th>
									<th scope="col" className="w-12 py-2 pl-1 pr-4">
										<span className="sr-only">{tCommon('delete')}</span>
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{filtered.map((route) => (
									<tr
										key={route.id}
										className={
											selectedIds.includes(route.id)
												? 'bg-blue-50/40'
												: 'hover:bg-gray-50/60'
										}
									>
										<td className="py-2.5 pl-4 pr-2">
											<input
												type="checkbox"
												checked={selectedIds.includes(route.id)}
												disabled={disabled}
												className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
												aria-label={t('selectRoute', {
													model: isModelView
														? route.provider_name || route.provider_id
														: route.model_name || route.model_id,
													id: route.id,
												})}
												onChange={(event) =>
													setSelected(
														event.target.checked
															? [...selectedIds, route.id]
															: selectedIds.filter((id) => id !== route.id)
													)
												}
											/>
										</td>
										<td className="min-w-0 px-3 py-2.5">
											<div className="flex min-w-0 items-center gap-2">
												{isModelView ? (
													<span className="truncate font-medium leading-5 text-gray-800">
														{route.provider_name || route.provider_id}
													</span>
												) : (
													<Link
														href={`/gateway/routes?model_id=${encodeURIComponent(
															route.model_id
														)}`}
														aria-disabled={disabled}
														tabIndex={disabled ? -1 : undefined}
														onClick={(event) => {
															if (disabled) event.preventDefault();
														}}
														className={`inline-flex min-w-0 items-center gap-1 font-medium leading-5 text-blue-700 hover:underline ${
															disabled ? 'pointer-events-none opacity-50' : ''
														}`}
													>
														<span className="truncate">
															{route.model_name || route.model_id}
														</span>
														<ArrowTopRightOnSquareIcon
															className="h-3 w-3 shrink-0 text-blue-400"
															aria-hidden
														/>
													</Link>
												)}
												<InfoHintPopover
													label={t('routeDetails', { id: route.id })}
													openOnHover
													openOnFocus
													portal
													align="start"
												>
													<dl className="space-y-3">
														<div>
															<dt className="text-gray-400">{t('routeId')}</dt>
															<dd className="mt-0.5 break-all font-mono leading-5 text-gray-700">
																{route.id}
															</dd>
														</div>
														<div>
															<dt className="text-gray-400">
																{isModelView
																	? t('providerName')
																	: t('modelName')}
															</dt>
															<dd className="mt-0.5 break-words leading-5 text-gray-700">
																{isModelView
																	? route.provider_name || route.provider_id
																	: route.model_name || route.model_id}
															</dd>
														</div>
														<div>
															<dt className="text-gray-400">
																{isModelView ? t('providerId') : t('modelId')}
															</dt>
															<dd className="mt-0.5 break-all font-mono leading-5 text-gray-700">
																{isModelView
																	? route.provider_id
																	: route.model_id}
															</dd>
														</div>
														<div>
															<dt className="text-gray-400">{t('upstream')}</dt>
															<dd className="mt-0.5 break-all font-mono leading-5 text-gray-700">
																{route.provider_model_name}
															</dd>
														</div>
														<div>
															<dt className="text-gray-400">{t('protocol')}</dt>
															<dd className="mt-0.5 break-all font-mono leading-5 text-gray-700">
																{route.upstream_protocol} /{' '}
																{route.upstream_operation || '*'}
															</dd>
														</div>
														<div>
															<dt className="text-gray-400">{t('group')}</dt>
															<dd className="mt-0.5 break-all font-mono leading-5 text-gray-700">
																{route.route_group}
															</dd>
														</div>
														{isModelView ? (
															<div>
																<dt className="text-gray-400">
																	{t('priority')} / {t('weight')}
																</dt>
																<dd className="mt-0.5 font-mono leading-5 text-gray-700">
																	{route.priority} / {route.weight ?? 1}
																</dd>
															</div>
														) : null}
													</dl>
												</InfoHintPopover>
											</div>
											<p className="mt-1 truncate font-mono text-xs leading-4 text-gray-500">
												{route.provider_model_name}
											</p>
										</td>
										<td className="px-3 py-2.5">
											<div className="flex items-center gap-1.5 text-xs font-medium leading-5 text-gray-700">
												<UpstreamProtocolBrandIcon
													protocol={route.upstream_protocol}
												/>
												{isUpstreamProtocol(route.upstream_protocol)
													? tUpstream(route.upstream_protocol)
													: route.upstream_protocol}
											</div>
											<RouteCapabilityBadges
												protocol={route.upstream_protocol}
												operation={route.upstream_operation}
											/>
										</td>
										<td className="px-3 py-2.5">
											<span className="inline-block max-w-full truncate rounded bg-gray-100/80 px-1.5 py-0.5 font-mono text-xs text-gray-500">
												{route.route_group}
											</span>
										</td>
										{isModelView ? (
											<td className="px-3 py-2.5">
												<span className="font-mono text-xs tabular-nums text-gray-600">
													{route.priority}{' '}
													<span className="text-gray-300">/</span>{' '}
													{route.weight ?? 1}
												</span>
											</td>
										) : null}
										<td className="px-3 py-2.5">
											<span
												className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${
													route.status === 'active'
														? 'text-emerald-700'
														: 'text-gray-400'
												}`}
											>
												<span
													className={`h-1.5 w-1.5 rounded-full ${
														route.status === 'active'
															? 'bg-emerald-500'
															: 'bg-gray-300'
													}`}
													aria-hidden
												/>
												{route.status === 'active'
													? t('active')
													: t('inactive')}
											</span>
										</td>
										<td className="py-2.5 pl-1 pr-4">
											<button
												type="button"
												disabled={disabled}
												onClick={() => void state.remove([route.id])}
												aria-label={t('deleteRoute', { id: route.id })}
												className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-40"
											>
												<TrashIcon className="h-4 w-4" aria-hidden />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{!filtered.length ? (
							<p className="px-4 py-10 text-center text-sm text-gray-400">
								{t('noResults')}
							</p>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
