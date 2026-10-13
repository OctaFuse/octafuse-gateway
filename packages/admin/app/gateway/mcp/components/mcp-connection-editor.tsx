'use client';
import { useState } from 'react';
import { EyeIcon, EyeSlashIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { ServerForm } from '../mcp-types';
const INPUT =
	'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-gray-50 read-only:text-gray-500';
export function McpConnectionEditor({
	form,
	mode,
	urlMasked,
	savedHeaderNames,
	onChange,
}: {
	form: ServerForm;
	mode: 'create' | 'edit';
	urlMasked?: string;
	savedHeaderNames: string[];
	onChange: (form: ServerForm) => void;
}) {
	const t = useTranslations('mcp');
	const [visible, setVisible] = useState(false);
	const removedHeaders = savedHeaderNames.filter(
		(key) => !form.headers.some((row) => row.key.trim() === key)
	);
	return (
		<div className="grid gap-5 md:grid-cols-2 md:gap-6">
			<section>
				<h3 className="mb-3 text-sm font-semibold text-gray-900">{t('basicInfo')}</h3>
				<div className="grid gap-4 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
					<label className="text-sm font-medium text-gray-700">
						{t('name')} <span className="text-red-500">*</span>
						<input
							required
							maxLength={120}
							value={form.name}
							placeholder={t('namePlaceholder')}
							onChange={(e) => onChange({ ...form, name: e.target.value })}
							className={INPUT}
						/>
					</label>
					<label className="text-sm font-medium text-gray-700">
						{t('slug')} <span className="text-red-500">*</span>
						<input
							required
							pattern={'[a-z0-9]([a-z0-9\\-]{0,38}[a-z0-9])?'}
							maxLength={40}
							readOnly={mode === 'edit'}
							value={form.slug}
							placeholder="my-mcp"
							onChange={(e) => onChange({ ...form, slug: e.target.value })}
							className={`${INPUT} font-mono`}
						/>
						<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-400">
							{t(mode === 'edit' ? 'slugReadonly' : 'slugHint')}
						</span>
					</label>
					<label className="text-sm font-medium text-gray-700 sm:col-span-2 md:col-span-1 lg:col-span-2">
						{t('description')}
						<textarea
							maxLength={2000}
							value={form.description}
							placeholder={t('descriptionPlaceholder')}
							onChange={(e) => onChange({ ...form, description: e.target.value })}
							rows={2}
							className={INPUT}
						/>
					</label>
				</div>
			</section>
			<section className="border-t border-gray-100 pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
				<h3 className="mb-3 text-sm font-semibold text-gray-900">{t('connectionSettings')}</h3>
				<label className="block text-sm font-medium text-gray-700">
					{t('url')} {mode === 'create' ? <span className="text-red-500">*</span> : null}
					<input
						type="url"
						pattern="https?://.+"
						maxLength={2048}
						required={mode === 'create'}
						value={form.url}
						placeholder={mode === 'edit' ? urlMasked : 'https://example.com/mcp'}
						onChange={(e) => onChange({ ...form, url: e.target.value })}
						className={`${INPUT} font-mono`}
					/>
					<span className="mt-1.5 block text-xs font-normal leading-5 text-gray-400">
						{t(mode === 'edit' ? 'urlKeep' : 'urlHint')}
					</span>
				</label>
				<div className="mt-5">
					<div className="mb-2 flex items-center justify-between gap-2">
						<h4 className="text-sm font-medium text-gray-700">{t('headers')}</h4>
						<button
							type="button"
							onClick={() => setVisible(!visible)}
							aria-label={t(visible ? 'hide' : 'reveal')}
							className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900"
						>
							{visible ? (
								<EyeSlashIcon className="h-4 w-4" aria-hidden="true" />
							) : (
								<EyeIcon className="h-4 w-4" aria-hidden="true" />
							)}
							{t(visible ? 'hide' : 'showValues')}
						</button>
					</div>
					<p className="mb-3 text-xs leading-5 text-gray-400">
						{t(mode === 'edit' ? 'headerEditHint' : 'headerHint')}
					</p>
					<div className="space-y-2">
						{form.headers.map((row, index) => (
							<div key={index} className="flex items-start gap-2">
								<div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[2fr_3fr]">
									<input
										aria-label={t('headerKey')}
										value={row.key}
										placeholder="Authorization"
										onChange={(e) =>
											onChange({
												...form,
												headers: form.headers.map((item, i) =>
													i === index ? { ...item, key: e.target.value } : item
												),
											})
										}
										className={`${INPUT} !mt-0 font-mono`}
									/>
									<input
										aria-label={t('headerValue')}
										type={visible ? 'text' : 'password'}
										autoComplete="off"
										maxLength={4096}
										value={row.value}
										placeholder={
											mode === 'edit' && savedHeaderNames.includes(row.key)
												? t('headerKeep')
												: t('headerValue')
										}
										onChange={(e) =>
											onChange({
												...form,
												headers: form.headers.map((item, i) =>
													i === index ? { ...item, value: e.target.value } : item
												),
											})
										}
										className={`${INPUT} !mt-0 font-mono`}
									/>
								</div>
								<button
									type="button"
									aria-label={t('removeHeader')}
									title={t('removeHeader')}
									onClick={() => onChange({ ...form, headers: form.headers.filter((_, i) => i !== index) })}
									className="mt-1 rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
								>
									<TrashIcon className="h-4 w-4" aria-hidden="true" />
								</button>
							</div>
						))}
					</div>
					<button
						type="button"
						disabled={form.headers.length >= 20}
						onClick={() => onChange({ ...form, headers: [...form.headers, { key: '', value: '' }] })}
						className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
					>
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
						{t('addHeader')}
					</button>
					{removedHeaders.length ? (
						<p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
							{t('removedHeadersWarning', { names: removedHeaders.join(', ') })}
						</p>
					) : null}
				</div>
			</section>
		</div>
	);
}
