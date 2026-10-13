'use client';

import { useId, useState, type FormEvent } from 'react';
import { ArrowDownTrayIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	applyMcpImport,
	parseMcpClientConfig,
	type McpImportCandidate,
	type McpImportFailure,
} from '@/lib/mcp-config-import';
import { useFeedback } from '@/components/feedback';
import type { ServerForm } from '../mcp-types';
import { McpDialog } from './mcp-dialog';
import { McpPricingDraftSummary, McpPricingEditor } from './mcp-pricing-editor';
import { McpConnectionEditor } from './mcp-connection-editor';
import { McpAdvancedSettings } from './mcp-advanced-settings';
import { pricingRuleFromDraft } from '../mcp-pricing-draft';
const SECTIONS = ['connection', 'pricing', 'advanced'] as const;
type Section = (typeof SECTIONS)[number];

const INPUT =
	'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-gray-50 read-only:text-gray-500';

export function McpServerFormModal({
	currency,
	mode,
	form,
	busy,
	urlMasked,
	savedHeaderNames,
	onChange: onFormChange,
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
	const formId = useId();
	const [entry, setEntry] = useState<'manual' | 'import'>('manual');
	const [paste, setPaste] = useState('');
	const [choices, setChoices] = useState<McpImportCandidate[] | null>(null);
	const [choiceIndex, setChoiceIndex] = useState(0);
	const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
	const [section, setSection] = useState<Section>('connection');
	const [validation, setValidation] = useState<string | null>(null);
	const [initialForm] = useState(() => JSON.stringify(form));
	const { confirm } = useFeedback();
	function onChange(nextForm: ServerForm) {
		setValidation(null);
		onFormChange(nextForm);
	}
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
	function revealField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
		const panel = field.closest<HTMLElement>('[data-section]');
		if (panel) setSection(panel.dataset.section as Section);
		setEntry('manual');
		for (let node = field.parentElement; node; node = node.parentElement) {
			if (node instanceof HTMLDetailsElement) node.open = true;
		}
		requestAnimationFrame(() => {
			field.focus();
			field.reportValidity();
		});
	}
	function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const element = event.currentTarget;
		setValidation(null);
		for (const field of Array.from(element.elements)) {
			if (
				(field instanceof HTMLInputElement ||
					field instanceof HTMLTextAreaElement ||
					field instanceof HTMLSelectElement) &&
				!field.checkValidity()
			) {
				revealField(field);
				return;
			}
		}
		const keys = form.headers.map((h) => h.key.trim().toLowerCase()).filter(Boolean);
		let connectionError: string | null = null;
		if (form.slug.trim() === 'builtin') connectionError = t('slugReserved');
		else if (new Set(keys).size !== keys.length) connectionError = t('duplicateHeaders');
		else if (
			form.headers.some(
				(row) =>
					(row.value && !row.key.trim()) ||
					(row.key.trim() && !row.value && (mode === 'create' || !savedHeaderNames.includes(row.key.trim())))
			)
		)
			connectionError = t('headerRequired');
		if (connectionError) {
			setSection('connection');
			setEntry('manual');
			setValidation(connectionError);
			const field = element.querySelector<HTMLInputElement>(
				form.slug.trim() === 'builtin' ? 'input[pattern]' : 'input[aria-label]'
			);
			requestAnimationFrame(() => field?.focus());
			return;
		}
		const pricing = pricingRuleFromDraft(form.pricing);
		if (!pricing.ok) {
			setValidation(t(`pricing.${pricing.error}`));
			const key =
				(['standard', 'chargedFactor', 'meteredFactor'] as const).find(
					(key) =>
						!form.pricing[key].trim() ||
						!Number.isFinite(Number(form.pricing[key])) ||
						Number(form.pricing[key]) < 0
				) ?? 'standard';
			const field = element.querySelector<HTMLInputElement>(`[data-pricing-field="${key}"]`);
			if (field) {
				revealField(field);
			}
			return;
		}
		onSubmit();
	}

	return (
		<McpDialog
			width="form"
			navigation={
				<div
					className="grid grid-cols-3 gap-1 px-5 sm:px-6"
					role="tablist"
					aria-label={t('settingsSections')}
				>
					{SECTIONS.map((key, index) => (
						<button
							key={key}
							id={`${formId}-${key}-tab`}
							type="button"
							role="tab"
							aria-selected={section === key}
							aria-controls={`${formId}-${key}-panel`}
							tabIndex={section === key ? 0 : -1}
							disabled={busy}
							onClick={() => setSection(key)}
							onKeyDown={(event) => {
								const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
								const target =
									event.key === 'Home'
										? 0
										: event.key === 'End'
										? SECTIONS.length - 1
										: offset
										? (index + offset + SECTIONS.length) % SECTIONS.length
										: null;
								if (target === null) return;
								event.preventDefault();
								document.getElementById(`${formId}-${SECTIONS[target]}-tab`)?.focus();
								setSection(SECTIONS[target]);
							}}
							className={`border-b-2 px-2 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
								section === key
									? 'border-gray-900 text-gray-900'
									: 'border-transparent text-gray-500 hover:text-gray-800'
							}`}
						>
							{t(`formTabs.${key}`)}
						</button>
					))}
				</div>
			}
			title={mode === 'create' ? t('add') : t('editSettings')}
			subtitle={mode === 'create' ? t('createSubtitle') : t('editSubtitle')}
			busy={busy}
			onClose={() => void requestClose()}
			footer={
				<div className="flex items-center justify-between gap-3">
					<div className="hidden min-w-0 sm:block">
						<McpPricingDraftSummary value={form.pricing} currency={currency} />
						<p className="mt-1 text-xs text-gray-500">{t('saveHint')}</p>
					</div>
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
							disabled={busy || (section === 'connection' && entry === 'import')}
							className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							{busy ? common('saving') : mode === 'create' ? t('createServer') : common('save')}
						</button>
					</div>
				</div>
			}
		>
			<div hidden={section !== 'connection'}>
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
							<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
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
			</div>
			<form
				id={formId}
				noValidate
				onInput={(event) => {
					const field = event.target;
					if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
						field.setCustomValidity('');
					setValidation(null);
				}}
				onSubmit={submit}
			>
				<fieldset disabled={busy} className="min-w-0">
					<div
						id={`${formId}-connection-panel`}
						role="tabpanel"
						aria-labelledby={`${formId}-connection-tab`}
						data-section="connection"
						hidden={section !== 'connection' || entry !== 'manual'}
					>
						<McpConnectionEditor
							form={form}
							mode={mode}
							urlMasked={urlMasked}
							savedHeaderNames={savedHeaderNames}
							onChange={onChange}
						/>
					</div>
					<section
						id={`${formId}-pricing-panel`}
						role="tabpanel"
						aria-labelledby={`${formId}-pricing-tab`}
						data-section="pricing"
						hidden={section !== 'pricing'}
					>
						<div className="mb-4">
							<h3 className="text-sm font-semibold text-gray-900">{t('pricing.title')}</h3>
							<p className="mt-1 text-xs leading-5 text-gray-500">{t('pricing.simpleDefaultHint')}</p>
						</div>
						<McpPricingEditor
							value={form.pricing}
							currency={currency}
							onChange={(pricing) => onChange({ ...form, pricing })}
						/>
					</section>
					<div
						id={`${formId}-advanced-panel`}
						role="tabpanel"
						aria-labelledby={`${formId}-advanced-tab`}
						data-section="advanced"
						hidden={section !== 'advanced'}
					>
						<McpAdvancedSettings form={form} onChange={onChange} />
					</div>
					{validation ? (
						<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
							{validation}
						</p>
					) : null}
				</fieldset>
			</form>
		</McpDialog>
	);
}
