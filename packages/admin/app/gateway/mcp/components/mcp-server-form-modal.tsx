'use client';

import { useId, useState } from 'react';
import {
	EyeIcon,
	EyeSlashIcon,
	PlusIcon,
	TrashIcon,
	ArrowDownTrayIcon,
	PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ToolPriceTripleInputs } from '@/app/gateway/tools/components/tool-price-triple-inputs';
import {
	applyMcpImport,
	parseMcpClientConfig,
	type McpImportCandidate,
	type McpImportFailure,
} from '@/lib/mcp-config-import';
import { useFeedback } from '@/components/feedback';
import type { ServerForm } from '../mcp-types';
import { McpDialog } from './mcp-dialog';

const INPUT =
	'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-gray-50 read-only:text-gray-500';

export function McpServerFormModal({
	currency,
	mode,
	form,
	busy,
	urlMasked,
	savedHeaderNames,
	onChange,
	onClose,
	onSubmit,
}: {
	currency: string;
	mode: 'create' | 'edit';
	form: ServerForm;
	busy: boolean;
	urlMasked?: string;
	savedHeaderNames: string[];
	onChange: (form: ServerForm) => void;
	onClose: () => void;
	onSubmit: () => void;
}) {
	const t = useTranslations('mcp');
	const common = useTranslations('common');
	const tools = useTranslations('tools');
	const formId = useId();
	const [entry, setEntry] = useState<'manual' | 'import'>('manual');
	const [paste, setPaste] = useState('');
	const [choices, setChoices] = useState<McpImportCandidate[] | null>(null);
	const [choiceIndex, setChoiceIndex] = useState(0);
	const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
	const [visible, setVisible] = useState(false);
	const [validation, setValidation] = useState<string | null>(null);
	const [initialForm] = useState(() => JSON.stringify(form));
	const { confirm } = useFeedback();
	async function requestClose() {
		if (busy) return;
		if (
			(JSON.stringify(form) !== initialForm || paste.trim()) &&
			!(await confirm({
				title: t('discardTitle'),
				message: t('discardMessage'),
				confirmLabel: t('discard'),
				cancelLabel: t('keepEditing'),
			}))
		)
			return;
		onClose();
	}

	function failureText(reason: McpImportFailure): string {
		return t(
			reason === 'empty'
				? 'importEmpty'
				: reason === 'stdio'
				? 'importStdio'
				: reason === 'sse'
				? 'importSse'
				: reason === 'oauth'
				? 'importOauth'
				: 'importInvalid'
		);
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
		const selected = parsed.servers[Math.min(choiceIndex, parsed.servers.length - 1)];
		if (!selected) return;
		onChange(applyMcpImport(form, selected, mode));
		setMessage({ tone: 'ok', text: t('importApplied') });
		setEntry('manual');
		setValidation(null);
	}
	const removedHeaders = savedHeaderNames.filter(
		(key) => !form.headers.some((row) => row.key.trim() === key)
	);

	return (
		<McpDialog
			title={mode === 'create' ? t('add') : t('editSettings')}
			subtitle={mode === 'create' ? t('createSubtitle') : t('editSubtitle')}
			busy={busy}
			onClose={() => void requestClose()}
			footer={
				<div className="flex items-center justify-between gap-3">
					<p className="hidden text-xs text-gray-500 sm:block">{t('saveHint')}</p>
					<div className="ml-auto flex gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => void requestClose()}
							className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
						>
							{common('cancel')}
						</button>
						<button
							type="submit"
							form={formId}
							disabled={busy || entry === 'import'}
							className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							{busy ? common('saving') : mode === 'create' ? t('createServer') : common('save')}
						</button>
					</div>
				</div>
			}
		>
			<div className="mb-5 flex gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label={t('entryMode')}>
				{(['manual', 'import'] as const).map((key) => (
					<button
						key={key}
						type="button"
						disabled={busy}
						aria-pressed={entry === key}
						onClick={() => setEntry(key)}
						className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
							entry === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
						}`}
					>
						{key === 'manual' ? (
							<PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
						) : (
							<ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />
						)}
						{t(key === 'manual' ? 'manualEntry' : 'importTitle')}
					</button>
				))}
			</div>
			{message && entry === 'manual' ? (
				<p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
					{message.text}
				</p>
			) : null}
			{entry === 'import' ? (
				<div className="space-y-4">
					<div>
						<h3 className="font-semibold text-gray-900">{t('importTitle')}</h3>
						<p className="mt-1 text-sm leading-6 text-gray-500">{t('importHint')}</p>
					</div>
					<label className="block text-sm font-medium text-gray-700">
						{t('importConfig')}
						<textarea
							value={paste}
							onChange={(e) => {
								setPaste(e.target.value);
								setChoices(null);
								setMessage(null);
								setChoiceIndex(0);
							}}
							rows={8}
							placeholder={t('importPlaceholder')}
							spellCheck={false}
							className={`${INPUT} font-mono`}
						/>
					</label>
					{choices && choices.length > 1 ? (
						<label className="block text-sm font-medium text-gray-700">
							{t('importPick')}
							<select
								value={choiceIndex}
								onChange={(e) => setChoiceIndex(Number(e.target.value))}
								className={INPUT}
							>
								{choices.map((choice, index) => (
									<option key={`${choice.slug}-${index}`} value={index}>
										{choice.name || choice.url}
									</option>
								))}
							</select>
						</label>
					) : null}
					{message?.tone === 'err' ? (
						<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
							{message.text}
						</p>
					) : null}
					<button
						type="button"
						disabled={!paste.trim()}
						onClick={fillFromPaste}
						className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{t('importApply')}
					</button>
					<p className="text-xs leading-5 text-gray-400">{t('importReviewHint')}</p>
				</div>
			) : null}
			<form
				id={formId}
				hidden={entry !== 'manual'}
				onSubmit={(e) => {
					e.preventDefault();
					const keys = form.headers.map((h) => h.key.trim().toLowerCase()).filter(Boolean);
					if (form.slug.trim() === 'builtin') {
						setValidation(t('slugReserved'));
						return;
					}
					if (new Set(keys).size !== keys.length) {
						setValidation(t('duplicateHeaders'));
						return;
					}
					if (
						form.headers.some(
							(row) =>
								(row.value && !row.key.trim()) ||
								(row.key.trim() &&
									!row.value &&
									(mode === 'create' || !savedHeaderNames.includes(row.key.trim())))
						)
					) {
						setValidation(t('headerRequired'));
						return;
					}
					setValidation(null);
					onSubmit();
				}}
			>
				<fieldset disabled={busy} className="min-w-0 space-y-6">
					<section>
						<h3 className="mb-3 text-sm font-semibold text-gray-900">{t('basicInfo')}</h3>
						<div className="grid gap-4 sm:grid-cols-2">
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
							<label className="text-sm font-medium text-gray-700 sm:col-span-2">
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
					<section className="border-t border-gray-100 pt-5">
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
											onClick={() =>
												onChange({ ...form, headers: form.headers.filter((_, i) => i !== index) })
											}
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
					<details className="rounded-lg border border-gray-200 bg-gray-50/60">
						<summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700">
							{t('advancedSettings')}
						</summary>
						<div className="space-y-5 border-t border-gray-200 p-4">
							<div className="grid gap-4 sm:grid-cols-2">
								<label className="text-sm text-gray-700">
									{t('timeout')}
									<input
										type="number"
										required
										min={1000}
										max={120000}
										step={1}
										value={form.timeoutMs}
										onChange={(e) => onChange({ ...form, timeoutMs: e.target.value })}
										className={INPUT}
									/>
									<span className="mt-1 block text-xs text-gray-400">{t('timeoutHint')}</span>
								</label>
								<label className="text-sm text-gray-700">
									{t('maxBytes')}
									<input
										type="number"
										required
										min={1000}
										max={8000000}
										step={1}
										value={form.maxResponseBytes}
										onChange={(e) => onChange({ ...form, maxResponseBytes: e.target.value })}
										className={INPUT}
									/>
									<span className="mt-1 block text-xs text-gray-400">{t('maxBytesHint')}</span>
								</label>
							</div>
							<div>
								<p className="text-sm font-medium text-gray-700">{tools('unitPrices.title', { currency })}</p>
								<p className="mt-1 text-xs leading-5 text-gray-400">{t('defaultPriceHint')}</p>
								<ToolPriceTripleInputs
									step="any"
									value={{ metered: form.metered, standard: form.standard, charged: form.charged }}
									onChange={(patch) => onChange({ ...form, ...patch })}
								/>
							</div>
						</div>
					</details>
					{validation ? (
						<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
							{validation}
						</p>
					) : null}
				</fieldset>
			</form>
		</McpDialog>
	);
}
