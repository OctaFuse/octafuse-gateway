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
import type { ProviderRoutesState } from '../use-provider-routes';

export function ProviderRelatedRoutes({
	state,
	disabled,
}: {
	state: ProviderRoutesState;
	disabled: boolean;
}) {
	const t = useTranslations('providers.modal.relatedRoutes');
	const tCommon = useTranslations('common');
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<string[]>([]);
	const selectAllRef = useRef<HTMLInputElement>(null);
	const normalized = query.trim().toLocaleLowerCase();
	const filtered = state.routes.filter((route) =>
		[
			route.id,
			route.model_name,
			route.model_id,
			route.provider_model_name,
			route.upstream_protocol,
			route.upstream_operation,
			route.route_group,
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
		<div className="space-y-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-gray-900">
						{t('title')}
					</h3>
					<p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
						{t('hint')}
					</p>
				</div>
				<button
					type="button"
					onClick={state.reload}
					disabled={disabled || state.loading}
					className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
				>
					<ArrowPathIcon
						className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`}
						aria-hidden
					/>
					{t('refresh')}
				</button>
			</div>
			{state.error ? (
				<div
					role="alert"
					className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
				>
					<p className="font-medium">{t('loadFailed')}</p>
					<p className="mt-1 break-words">{state.error}</p>
					<button
						type="button"
						onClick={state.reload}
						className="mt-3 font-medium underline"
					>
						{t('retry')}
					</button>
				</div>
			) : state.loading ? (
				<p role="status" className="py-16 text-center text-sm text-gray-500">
					{tCommon('loading')}
				</p>
			) : !state.routes.length ? (
				<div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center">
					<ShareIcon className="mx-auto h-9 w-9 text-gray-300" aria-hidden />
					<p className="mt-4 text-sm font-semibold text-gray-900">
						{t('empty')}
					</p>
					<p className="mt-2 text-sm text-gray-500">{t('emptyHint')}</p>
				</div>
			) : (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="relative min-w-0 flex-1 sm:max-w-sm">
							<MagnifyingGlassIcon
								className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400"
								aria-hidden
							/>
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={t('search')}
								aria-label={t('search')}
								className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<button
							type="button"
							onClick={() => void state.remove(selectedIds)}
							disabled={disabled || !selectedIds.length}
							className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
						>
							<TrashIcon className="h-4 w-4" aria-hidden />
							{t('deleteSelected', { count: selectedIds.length })}
						</button>
					</div>
					<p className="text-xs text-gray-500">
						{t('summary', {
							count: state.routes.length,
							active: state.routes.filter((route) => route.status === 'active')
								.length,
						})}
					</p>
					<div className="overflow-x-auto rounded-lg border border-gray-200">
						<table className="w-full min-w-[660px] text-left text-sm">
							<thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
								<tr>
									<th className="w-10 p-3">
										<input
											ref={selectAllRef}
											type="checkbox"
											aria-label={t('selectAll')}
											checked={allSelected}
											disabled={disabled || !filtered.length}
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
									<th className="p-3 font-medium">{t('model')}</th>
									<th className="p-3 font-medium">{t('upstream')}</th>
									<th className="p-3 font-medium">{t('protocol')}</th>
									<th className="p-3 font-medium">{t('group')}</th>
									<th className="p-3 font-medium">{t('status')}</th>
									<th className="p-3 font-medium">
										<span className="sr-only">{tCommon('delete')}</span>
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{filtered.map((route) => (
									<tr key={route.id} className="hover:bg-gray-50/70">
										<td className="p-3">
											<input
												type="checkbox"
												checked={selectedIds.includes(route.id)}
												disabled={disabled}
												aria-label={t('selectRoute', {
													model: route.model_name || route.model_id,
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
										<td className="max-w-[190px] p-3">
											<Link
												href={`/gateway/routes?model_id=${encodeURIComponent(
													route.model_id
												)}`}
												aria-disabled={disabled}
												tabIndex={disabled ? -1 : undefined}
												onClick={(event) => {
													if (disabled) event.preventDefault();
												}}
												className={`inline-flex items-center gap-1 font-medium text-blue-700 hover:underline ${
													disabled ? 'pointer-events-none opacity-50' : ''
												}`}
											>
												<span className="break-all">
													{route.model_name || route.model_id}
												</span>
												<ArrowTopRightOnSquareIcon
													className="h-3 w-3 shrink-0"
													aria-hidden
												/>
											</Link>
											<p className="mt-1 break-all font-mono text-[11px] text-gray-400">
												{route.id}
											</p>
										</td>
										<td className="max-w-[190px] break-all p-3 font-mono text-xs text-gray-600">
											{route.provider_model_name}
										</td>
										<td className="p-3">
											<span className="rounded bg-slate-100 px-1.5 py-1 text-xs text-slate-600">
												{route.upstream_protocol}
											</span>
											<p className="mt-1.5 text-[11px] text-gray-400">
												{route.upstream_operation || '*'}
											</p>
										</td>
										<td className="max-w-[100px] break-all p-3 text-xs text-gray-600">
											{route.route_group}
										</td>
										<td className="whitespace-nowrap p-3">
											<span
												className={`rounded-full px-2 py-1 text-xs ${
													route.status === 'active'
														? 'bg-emerald-50 text-emerald-700'
														: 'bg-gray-100 text-gray-500'
												}`}
											>
												{route.status === 'active'
													? t('active')
													: t('inactive')}
											</span>
										</td>
										<td className="p-3">
											<button
												type="button"
												disabled={disabled}
												onClick={() => void state.remove([route.id])}
												aria-label={t('deleteRoute', { id: route.id })}
												className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
											>
												<TrashIcon className="h-4 w-4" aria-hidden />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
						{!filtered.length ? (
							<p className="p-8 text-center text-sm text-gray-500">
								{t('noResults')}
							</p>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
