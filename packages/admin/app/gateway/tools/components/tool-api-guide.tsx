'use client';

import { useId, useState } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { HighlightedCode } from '@/components/highlighted-code';
import type { CodeLanguage } from '@/lib/code-highlight';
import styles from './tool-content.module.css';
import { useTranslations } from 'next-intl';
import {
	TOOL_API_DEFINITIONS,
	AGENT_TOOL_FORMATS,
	AGENT_TOOL_DOCS,
	formatAgentToolDefinition,
	buildAgentToolHandler,
	type AgentToolFormat,
	buildAgentToolDefinition,
	buildToolCurl,
	buildToolExecutor,
	normalizeToolProxyUrl,
	toolApiUrl,
	type RestToolId,
} from '../tool-api-guide';

function CopyButton({ value, label }: { value: string; label: string }) {
	const t = useTranslations('tools.apiGuide');
	const common = useTranslations('common');
	const [result, setResult] = useState<'ok' | 'failed' | null>(null);
	async function copy() {
		try {
			if (navigator.clipboard?.writeText) {
				try {
					await navigator.clipboard.writeText(value);
					setResult('ok');
					return;
				} catch {
					// Fall back for HTTP self-hosting and restricted browser contexts.
				}
			}
			// Keep copy usable for HTTP self-hosting and browsers without Clipboard API focus support.
			const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			const area = document.createElement('textarea');
			area.value = value;
			area.readOnly = true;
			area.tabIndex = -1;
			area.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
			(previous?.closest('[role="dialog"]') ?? document.body).appendChild(area);
			let copied = false;
			const onCopy = (event: ClipboardEvent) => {
				if (!event.clipboardData) return;
				event.clipboardData.setData('text/plain', value);
				event.preventDefault();
			};
			document.addEventListener('copy', onCopy);
			try {
				area.focus();
				area.select();
				area.setSelectionRange(0, value.length);
				copied = document.execCommand('copy');
			} finally {
				document.removeEventListener('copy', onCopy);
				area.remove();
				previous?.focus();
			}
			if (!copied) throw new Error('clipboard');
			setResult('ok');
		} catch {
			setResult('failed');
		}
	}
	return (
		<span className="inline-flex shrink-0 items-center gap-2">
			<button
				type="button"
				onClick={() => void copy()}
				title={label}
				aria-label={label}
				className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
			>
				{result === 'ok' ? (
					<CheckIcon className="h-4 w-4 text-emerald-600" aria-hidden="true" />
				) : (
					<ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
				)}
				<span>{result === 'ok' ? common('copied') : common('copy')}</span>
			</button>
			{result === 'failed' ? (
				<span role="alert" className="text-xs text-red-600">
					{t('copyFailed')}
				</span>
			) : null}
		</span>
	);
}
function CodeSample({
	title,
	code,
	hint,
	language,
}: {
	title: string;
	code: string;
	hint?: string;
	language: CodeLanguage;
}) {
	const t = useTranslations('tools.apiGuide');
	return (
		<section className="min-w-0">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<h4 className="text-sm font-medium text-gray-900">{title}</h4>
					{hint ? (
						<InfoHintPopover label={title} openOnHover openOnFocus portal align="start">
							<p className="leading-5">{hint}</p>
						</InfoHintPopover>
					) : null}
				</div>
				<CopyButton key={code} value={code} label={t('copyCode', { name: title })} />
			</div>
			<HighlightedCode code={code} language={language} label={title} />
		</section>
	);
}

export function ToolEndpoint({ toolId, baseUrl }: { toolId: RestToolId; baseUrl: string }) {
	const t = useTranslations('tools.apiGuide');
	const validBase = normalizeToolProxyUrl(baseUrl);
	const url = toolApiUrl(toolId, baseUrl);
	const copyValue = validBase ? url : `/v1/tools/${toolId}`;
	return (
		<div className="flex min-w-0 items-center gap-3">
			<span className="rounded bg-emerald-50 px-2 py-1 font-mono text-xs font-medium text-emerald-700">POST</span>
			<code className="min-w-0 flex-1 break-all font-mono text-sm text-gray-800">{url}</code>
			<CopyButton key={copyValue} value={copyValue} label={validBase ? t('copyUrl') : t('copyPath')} />
		</div>
	);
}

export type ToolReferenceView = 'api' | 'agent';
export function ToolApiReference({
	toolId,
	baseUrl,
	view,
}: {
	toolId: RestToolId;
	baseUrl: string;
	view: ToolReferenceView;
}) {
	const t = useTranslations('tools.apiGuide');
	const groupId = useId();
	const [agentFormat, setAgentFormat] = useState<AgentToolFormat>('generic');
	const tool = TOOL_API_DEFINITIONS[toolId];
	const fields = Object.fromEntries(Object.keys(tool.properties).map((name) => [name, t(`fields.${name}`)]));
	const descriptionKey = {
		'web-search': 'webSearch',
		'web-fetch': 'webFetch',
		'web-deep-search': 'webDeepSearch',
		'ai-detection': 'aiDetection',
	} as const;
	const descriptions = useTranslations('tools.toolGroups');
	const definition = buildAgentToolDefinition(toolId, descriptions(descriptionKey[toolId]), fields);
	return (
		<div className={`${styles.content} space-y-4`}>
			{!normalizeToolProxyUrl(baseUrl) ? <p className="text-xs leading-5 text-amber-700">{t('baseRequired')}</p> : null}
			{view === 'api' ? (
				<div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
					<code className="break-all font-mono">Authorization: Bearer USER_API_KEY</code>
					<InfoHintPopover label={t('authLabel')} openOnHover openOnFocus portal align="start">
						<p className="leading-5">{t('authHint')}</p>
					</InfoHintPopover>
				</div>
			) : null}
			{view === 'api' ? (
				<div className={styles.columns}>
					<section aria-labelledby={`${groupId}-request`}>
						<h4 id={`${groupId}-request`} className="mb-3 text-sm font-medium text-gray-900">
							{t('request')}
						</h4>
						<dl className="divide-y divide-gray-100 border-y border-gray-100">
							{Object.entries(tool.properties).map(([name, schema]) => (
								<div key={name} className="grid gap-2 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
									<dt className="flex flex-wrap items-baseline gap-2 text-xs">
										<code className="font-medium text-gray-800">{name}</code>
										<span className="text-gray-400">{schema.type}</span>
										{(tool.required as readonly string[]).includes(name) ? (
											<span className="text-amber-700">{t('required')}</span>
										) : null}
									</dt>
									<dd className="text-xs leading-5 text-gray-600">
										{fields[name]}
										{'default' in schema ? (
											<span className="ml-2 text-gray-400">{t('defaultValue', { value: schema.default })}</span>
										) : null}
									</dd>
								</div>
							))}
						</dl>
					</section>
					<section aria-labelledby={`${groupId}-response`}>
						<h4 id={`${groupId}-response`} className="mb-3 text-sm font-medium text-gray-900">
							{t('response')}
						</h4>
						<dl className="divide-y divide-gray-100 border-y border-gray-100">
							{Object.entries(tool.response).map(([path, type]) => (
								<div key={path} className="grid gap-2 py-2 sm:grid-cols-[15rem_minmax(0,1fr)]">
									<dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs text-gray-800">
										<code className="min-w-0 break-all">{path}</code>
										<span className="whitespace-nowrap text-gray-400">{type}</span>
									</dt>
									<dd className="text-xs leading-5 text-gray-600">{t(`responseFields.${path.split('.').at(-1)}`)}</dd>
								</div>
							))}
						</dl>
						<p className="mt-2 text-xs text-gray-400">{t('optionalHint')}</p>
					</section>
					<div className={styles.fullWidth}>
						<CodeSample language="bash" title={t('curl')} code={buildToolCurl(toolId, baseUrl)} hint={t('curlHint')} />
					</div>
					<details className={`${styles.fullWidth} border-t border-gray-100 pt-3 text-xs text-gray-600`}>
						<summary className="cursor-pointer font-medium">{t('errors')}</summary>
						<dl className="mt-3 space-y-2">
							{['400', '401', '403', '502', '503'].map((status) => (
								<div key={status} className="flex gap-3">
									<dt className="font-mono text-gray-900">{status}</dt>
									<dd>{t(`errorsByStatus.${status}`)}</dd>
								</div>
							))}
						</dl>
					</details>
				</div>
			) : (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs leading-5 text-gray-600">{t('agentFlow')}</p>
						<div className="flex flex-wrap items-center gap-3">
							<label htmlFor={`${groupId}-format`} className="text-xs text-gray-500">
								{t('format')}
							</label>
							<select
								id={`${groupId}-format`}
								value={agentFormat}
								onChange={(event) => setAgentFormat(event.target.value as AgentToolFormat)}
								className="h-8 max-w-full rounded-lg border border-gray-200 bg-white pl-3 pr-8 text-xs text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
							>
								{AGENT_TOOL_FORMATS.map((format) => (
									<option key={format} value={format}>
										{t(`formats.${format}`)}
									</option>
								))}
							</select>
							{AGENT_TOOL_DOCS[agentFormat] ? (
								<a
									href={AGENT_TOOL_DOCS[agentFormat]}
									target="_blank"
									rel="noopener noreferrer"
									className="text-xs text-gray-500 underline underline-offset-4 hover:text-gray-900"
								>
									{t('officialDocs')}
								</a>
							) : null}
						</div>
					</div>
					<p className="text-xs leading-5 text-gray-500">{t(`formatHints.${agentFormat}`)}</p>
					<div className={styles.columns}>
						<CodeSample
							language="json"
							title={t('definition')}
							code={JSON.stringify(formatAgentToolDefinition(definition, agentFormat), null, 2)}
							hint={t('agentHint')}
						/>
						<div className="min-w-0 space-y-4">
							<CodeSample
								language="ts"
								title={t('executor')}
								code={buildToolExecutor(toolId, baseUrl)}
								hint={t('executorHint')}
							/>
							<section aria-label={t('handler')} className="border-t border-gray-100 pt-3 text-xs text-gray-600">
								<p className="font-medium text-gray-900">{t('handler')}</p>
								<div className="mt-4 space-y-3">
									<p className="leading-5">{t(`handlerHints.${agentFormat}`)}</p>
									<CodeSample
										language="ts"
										title={t('handlerCode')}
										code={buildAgentToolHandler(toolId, agentFormat)}
									/>
									<p className="leading-5 text-gray-500">{t('agentRuntimeHint')}</p>
								</div>
							</section>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
