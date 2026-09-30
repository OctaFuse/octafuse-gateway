'use client';

import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { editorInputClass, editorPanelClass, RouteEditorSectionHeader } from './route-editor-ui';
import type { RouteModalProps } from './route-modal-types';

type Props = Pick<RouteModalProps, 'formData' | 'onFormChange'>;

export function RouteRequestFields({ formData, onFormChange }: Props) {
	const t = useTranslations('routes.modal');
	return (
		<div id="route-custom-params" className="grid items-stretch gap-4 lg:grid-cols-2">
			<section className={`${editorPanelClass} flex flex-col overflow-hidden`}>
				<RouteEditorSectionHeader
					title={t('customHeaders')}
					description={t('editor.headersDescription')}
					className="min-h-20"
					action={
						<button
							type="button"
							onClick={() =>
								onFormChange({
									...formData,
									custom_headers: [...formData.custom_headers, { name: '', value: '' }],
								})
							}
							className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<PlusIcon className="h-3.5 w-3.5" aria-hidden />
							{t('customHeadersAdd')}
						</button>
					}
				/>
				<div className="flex min-h-24 flex-1 flex-col p-5 lg:min-h-64">
					{formData.custom_headers.length ? (
						<div className="space-y-2">
							<div
								aria-hidden
								className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2rem] gap-2 px-1 pb-1 text-xs font-medium text-gray-500"
							>
								<span>{t('customHeadersName')}</span>
								<span>{t('customHeadersValue')}</span>
							</div>
							{formData.custom_headers.map((row, index) => (
								<div
									key={index}
									className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_2rem] items-center gap-2"
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
										className={`${editorInputClass} px-2.5 font-mono text-xs`}
										placeholder={t('customHeadersNamePlaceholder')}
										aria-label={t('customHeadersName')}
										autoComplete="off"
										spellCheck={false}
									/>
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
										className={`${editorInputClass} px-2.5 font-mono text-xs`}
										placeholder={t('customHeadersValuePlaceholder')}
										aria-label={t('customHeadersValue')}
										autoComplete="off"
										spellCheck={false}
									/>
									<button
										type="button"
										onClick={() =>
											onFormChange({
												...formData,
												custom_headers: formData.custom_headers.filter((_, i) => i !== index),
											})
										}
										className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
										aria-label={t('customHeadersRemove')}
										title={t('customHeadersRemove')}
									>
										<TrashIcon className="h-4 w-4" aria-hidden />
									</button>
								</div>
							))}
						</div>
					) : (
						<div className="flex min-h-36 flex-1 items-center justify-center px-5 text-center text-xs leading-5 text-gray-400 lg:min-h-52">
							{t('editor.headersEmpty')}
						</div>
					)}
				</div>
				<OverrideOption
					label={t('customBodyForceOverride')}
					checked={formData.custom_params_force_override_headers}
					onChange={(checked) => onFormChange({ ...formData, custom_params_force_override_headers: checked })}
					hint={
						formData.custom_params_force_override_headers
							? t('customHeadersHintForceOverride')
							: t('customHeadersHint')
					}
				/>
			</section>
			<section className={`${editorPanelClass} flex flex-col overflow-hidden`}>
				<RouteEditorSectionHeader
					title={t('customBody')}
					description={t('editor.bodyDescription')}
					className="min-h-20"
					action={<span className="pt-0.5 font-mono text-xs text-slate-400">JSON</span>}
				/>
				<div className="flex min-h-64 flex-1 flex-col p-5">
					<textarea
						rows={8}
						value={formData.custom_params_json}
						onChange={(e) => onFormChange({ ...formData, custom_params_json: e.target.value })}
						className="min-h-60 w-full flex-1 resize-y rounded-lg border border-gray-200 bg-white p-3 font-mono text-sm leading-6 text-gray-800 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
						placeholder={t('customParamsPlaceholder')}
						spellCheck={false}
						aria-label={t('customBody')}
					/>
				</div>
				<OverrideOption
					label={t('customBodyForceOverride')}
					checked={formData.custom_params_force_override_body}
					onChange={(checked) => onFormChange({ ...formData, custom_params_force_override_body: checked })}
					hint={
						formData.custom_params_force_override_body
							? t('customBodyHintForceOverride')
							: t('customBodyHint')
					}
				/>
			</section>
		</div>
	);
}

function OverrideOption({
	label,
	checked,
	onChange,
	hint,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	hint: string;
}) {
	return (
		<div
			className={`min-h-24 border-t px-5 py-4 ${
				checked ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50'
			}`}
		>
			<label
				className={`inline-flex cursor-pointer items-center gap-2 text-xs font-medium ${
					checked ? 'text-amber-800' : 'text-gray-700'
				}`}
			>
				<input
					type="checkbox"
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					className="h-4 w-4 rounded border-gray-300 accent-blue-600 focus:ring-blue-500"
				/>
				{label}
			</label>
			<p className="mt-1.5 text-xs leading-5 text-gray-500">{hint}</p>
		</div>
	);
}
