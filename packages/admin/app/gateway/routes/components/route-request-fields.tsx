'use client';

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { RouteModalProps } from './route-modal-types';

type Props = Pick<RouteModalProps, 'formData' | 'onFormChange'>;

export function RouteRequestFields({ formData, onFormChange }: Props) {
	const t = useTranslations('routes.modal');
	return (
		<div id="route-custom-params" className="space-y-4">
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
				<div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4">
					<div className="mb-2 flex items-start justify-between gap-2">
						<div className="min-w-0">
							<h4 className="text-sm font-semibold text-gray-800">{t('customHeaders')}</h4>
							<p className="mt-0.5 text-[11px] leading-4 text-gray-500">
								{formData.custom_params_force_override_headers
									? t('customHeadersHintForceOverride')
									: t('customHeadersHint')}
							</p>
						</div>
						<label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-amber-900">
							<input
								type="checkbox"
								checked={formData.custom_params_force_override_headers}
								onChange={(e) =>
									onFormChange({
										...formData,
										custom_params_force_override_headers: e.target.checked,
									})
								}
								className="h-3.5 w-3.5 rounded border-amber-300 text-amber-700 focus:ring-blue-500"
							/>
							{t('customBodyForceOverride')}
						</label>
					</div>
					<div className="flex min-h-0 flex-1 flex-col">
						{formData.custom_headers.length > 0 ? (
							<div className="mb-1.5 space-y-1.5">
								{formData.custom_headers.map((row, index) => (
									<div
										key={index}
										className="grid grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.3fr)_auto] items-center gap-1.5"
									>
										<input
											type="text"
											value={row.name}
											onChange={(e) =>
												onFormChange({
													...formData,
													custom_headers: formData.custom_headers.map((item, i) =>
														i === index ? { ...item, name: e.target.value } : item
													),
												})
											}
											className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
											placeholder={t('customHeadersNamePlaceholder')}
											aria-label={t('customHeadersName')}
											autoComplete="off"
											spellCheck={false}
										/>
										<span className="select-none font-mono text-xs text-amber-700/70" aria-hidden>
											:
										</span>
										<input
											type="text"
											value={row.value}
											onChange={(e) =>
												onFormChange({
													...formData,
													custom_headers: formData.custom_headers.map((item, i) =>
														i === index ? { ...item, value: e.target.value } : item
													),
												})
											}
											className="min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
											placeholder={t('customHeadersValuePlaceholder')}
											aria-label={t('customHeadersValue')}
											autoComplete="off"
											spellCheck={false}
										/>
										<button
											type="button"
											onClick={() => {
												onFormChange({
													...formData,
													custom_headers: formData.custom_headers.filter((_, i) => i !== index),
												});
											}}
											className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
											aria-label={t('customHeadersRemove')}
											title={t('customHeadersRemove')}
										>
											<TrashIcon className="h-4 w-4" aria-hidden />
										</button>
									</div>
								))}
							</div>
						) : null}
						<button
							type="button"
							onClick={() =>
								onFormChange({
									...formData,
									custom_headers: [...formData.custom_headers, { name: '', value: '' }],
								})
							}
							className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
						>
							<PlusIcon className="h-3.5 w-3.5" aria-hidden />
							{t('customHeadersAdd')}
						</button>
					</div>
				</div>
				<div className="flex min-h-0 min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4">
					<div className="flex items-start justify-between gap-2">
						<h4 className="text-sm font-semibold text-gray-800">{t('customBody')}</h4>
						<label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-amber-900">
							<input
								type="checkbox"
								checked={formData.custom_params_force_override_body}
								onChange={(e) =>
									onFormChange({
										...formData,
										custom_params_force_override_body: e.target.checked,
									})
								}
								className="h-3.5 w-3.5 rounded border-amber-300 text-amber-700 focus:ring-blue-500"
							/>
							{t('customBodyForceOverride')}
						</label>
					</div>
					<p className="mt-0.5 mb-2 text-[11px] leading-4 text-gray-500">
						{formData.custom_params_force_override_body
							? t('customBodyHintForceOverride')
							: t('customBodyHint')}
					</p>
					<textarea
						rows={10}
						value={formData.custom_params_json}
						onChange={(e) =>
							onFormChange({
								...formData,
								custom_params_json: e.target.value,
							})
						}
						className="min-h-[240px] flex-1 resize-y rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
						placeholder={t('customParamsPlaceholder')}
						spellCheck={false}
						aria-label={t('customBody')}
					/>
				</div>
			</div>
		</div>
	);
}
