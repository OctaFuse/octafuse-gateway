'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ToolPriceTripleInputs } from '@/app/gateway/tools/components/tool-price-triple-inputs';
import { applyMcpImport, parseMcpClientConfig, type McpImportCandidate, type McpImportFailure } from '@/lib/mcp-config-import';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import type { ServerForm } from '../mcp-types';

export function McpServerFormModal({
	mode,
	form,
	busy,
	urlMasked,
	onChange,
	onClose,
	onSubmit,
}: {
	mode: 'create' | 'edit';
	form: ServerForm;
	busy: boolean;
	urlMasked?: string;
	onChange: (form: ServerForm) => void;
	onClose: () => void;
	onSubmit: () => void;
}) {
	const t = useTranslations('mcp');
	const tCommon = useTranslations('common');
	const tTools = useTranslations('tools');
	const { currency } = useBillingCurrency();
	const [paste, setPaste] = useState('');
	const [choices, setChoices] = useState<McpImportCandidate[] | null>(null);
	const [choiceIndex, setChoiceIndex] = useState(0);
	const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

	function failureText(reason: McpImportFailure): string {
		if (reason === 'empty') return t('importEmpty');
		if (reason === 'stdio') return t('importStdio');
		if (reason === 'sse') return t('importSse');
		if (reason === 'oauth') return t('importOauth');
		return t('importInvalid');
	}

	function fillFromPaste() {
		const parsed = parseMcpClientConfig(paste);
		if (!parsed.ok) {
			setChoices(null);
			setMessage({ tone: 'err', text: failureText(parsed.reason) });
			return;
		}
		if (parsed.servers.length > 1 && choices === null) {
			setChoices(parsed.servers);
			setChoiceIndex(0);
			setMessage(null);
			return;
		}
		const index = parsed.servers.length > 1 ? Math.min(choiceIndex, parsed.servers.length - 1) : 0;
		const selected = parsed.servers[index];
		if (!selected) return;
		onChange(applyMcpImport(form, selected, mode));
		setChoices(parsed.servers.length > 1 ? parsed.servers : null);
		setMessage({ tone: 'ok', text: t('importApplied') });
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<form
				className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<h2 className="text-lg font-semibold text-gray-900">{mode === 'create' ? t('add') : t('edit')}</h2>
				<div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
					<div className="flex items-center justify-between gap-3">
						<span className="text-sm font-medium text-gray-800">{t('importTitle')}</span>
						<button type="button" onClick={fillFromPaste} className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50">{t('importApply')}</button>
					</div>
					<p className="mt-1 text-xs text-gray-500">{t('importHint')}</p>
					<textarea
						value={paste}
						onChange={(event) => {
							setPaste(event.target.value);
							setChoices(null);
							setMessage(null);
						}}
						rows={4}
						placeholder={t('importPlaceholder')}
						className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs shadow-sm"
					/>
					{choices && choices.length > 1 ? (
						<label className="mt-2 block text-xs text-gray-600">
							{t('importPick')}
							<select
								value={choiceIndex}
								onChange={(event) => setChoiceIndex(Number(event.target.value))}
								className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
							>
								{choices.map((choice, index) => (
									<option key={`${choice.slug}-${index}`} value={index}>{choice.name || choice.url}</option>
								))}
							</select>
						</label>
					) : null}
					{message ? <p className={`mt-2 text-xs ${message.tone === 'err' ? 'text-red-600' : 'text-gray-600'}`}>{message.text}</p> : null}
				</div>
				<div className="mt-4 grid gap-3 sm:grid-cols-2">
					<label className="text-sm text-gray-700">
						{t('slug')}
						<input
							required={mode === 'create'}
							readOnly={mode === 'edit'}
							value={form.slug}
							onChange={(event) => onChange({ ...form, slug: event.target.value })}
							className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm read-only:bg-gray-50"
						/>
						{mode === 'edit' ? <span className="mt-1 block text-xs text-gray-500">{t('slugReadonly')}</span> : null}
					</label>
					<label className="text-sm text-gray-700">
						{t('name')}
						<input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm" />
					</label>
					<label className="text-sm text-gray-700 sm:col-span-2">
						{t('description')}
						<textarea value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} rows={2} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm" />
					</label>
					<label className="text-sm text-gray-700 sm:col-span-2">
						{t('url')}
						<input required={mode === 'create'} value={form.url} onChange={(event) => onChange({ ...form, url: event.target.value })} placeholder={mode === 'edit' ? urlMasked : ''} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm" />
						{mode === 'edit' ? <span className="mt-1 block text-xs text-gray-500">{t('urlKeep')}</span> : null}
					</label>
					<div className="sm:col-span-2">
						<div className="mb-1 flex items-center justify-between">
							<span className="text-sm text-gray-700">{t('headers')}</span>
							<button type="button" className="text-xs font-medium text-blue-600" onClick={() => onChange({ ...form, headers: [...form.headers, { key: '', value: '' }] })}>{t('addHeader')}</button>
						</div>
						<div className="space-y-2">
							{form.headers.map((row, index) => (
								<div key={index} className="flex gap-2">
									<input value={row.key} placeholder={t('headerKey')} onChange={(event) => onChange({ ...form, headers: form.headers.map((item, i) => i === index ? { ...item, key: event.target.value } : item) })} className="w-40 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm" />
									<input value={row.value} placeholder={mode === 'edit' ? t('headerKeep') : t('headerValue')} onChange={(event) => onChange({ ...form, headers: form.headers.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm" />
									<button type="button" className="text-xs text-gray-500" onClick={() => onChange({ ...form, headers: form.headers.filter((_, i) => i !== index) })}>{tCommon('delete')}</button>
								</div>
							))}
						</div>
					</div>
					<label className="text-sm text-gray-700">
						{t('timeout')}
						<input type="number" min={1000} value={form.timeoutMs} onChange={(event) => onChange({ ...form, timeoutMs: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm" />
					</label>
					<label className="text-sm text-gray-700">
						{t('maxBytes')}
						<input type="number" min={1000} value={form.maxResponseBytes} onChange={(event) => onChange({ ...form, maxResponseBytes: event.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm" />
					</label>
					<div className="sm:col-span-2">
						<p className="mb-1 text-sm text-gray-700">{tTools('unitPrices.title', { currency })}</p>
						<ToolPriceTripleInputs
							value={{ metered: form.metered, standard: form.standard, charged: form.charged }}
							onChange={(patch) => onChange({ ...form, ...patch })}
						/>
					</div>
				</div>
				<div className="mt-5 flex justify-end gap-2">
					<button type="button" onClick={onClose} className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">{tCommon('cancel')}</button>
					<button type="submit" disabled={busy} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? tCommon('saving') : tCommon('save')}</button>
				</div>
			</form>
		</div>
	);
}
