'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayIcon, StopIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { isAudioTranscriptionModel } from '@octafuse/core/db/model-modalities';
import { isDashScopeRealtimeOperation } from '@/lib/dashscope-realtime-client';
import { validateAudioTranscriptionFile } from '@/lib/audio-transcriptions';
import {
	parseImagesGenerationsResponse,
	readFileAsDataUrl,
	validateEditImageFiles,
} from '@/lib/image-generations';
import { inferPlaygroundParseMode } from '@/lib/playground/merge-assistant-text';
import { previewPlaygroundResponse, readPlaygroundTextStream } from '@/lib/playground/response-preview';
import {
	quickTestLlmFamily,
	quickTestSample,
	setQuickTestStreaming,
} from '@/lib/playground/quick-test-samples';
import { PLAYGROUND_LLM_SAMPLE_IDS, type PlaygroundLlmSampleId } from '@/lib/playground/samples';
import { previewPlaygroundUpstreamUrl } from '@/lib/playground/preview-upstream-url';
import { normalizeProtocol } from '@/lib/playground/usage-parsing';
import { decodePlaygroundRequestHeadersHeader } from '@/lib/playground/outbound-headers';
import type { PlaygroundRouteDraft } from '@/lib/playground/route-draft';
import {
	decodeWireRequestBodyHeader,
	templateForRoute,
	previewPlaygroundMergedBody,
} from '../../playground/playground-utils';
import type { ResponseMeta, RouteListRow } from '../../playground/types';
import { composeCustomParamsJson } from '../route-utils';
import type { RouteModalProps } from './route-modal-types';
import { RouteTestOutput } from './route-test-output';
import { editorPanelClass, RouteEditorSectionHeader } from './route-editor-ui';

type Props = Pick<
	RouteModalProps,
	'formData' | 'selectedModel' | 'selectedProvider' | 'selectedModelIsImage' | 'selectedModelIsAudio'
>;

export function RouteQuickTest(props: Props) {
	const { formData: form } = props;
	// A different endpoint needs a different sample. Tab switches keep this component mounted.
	const key = [form.model_id, form.upstream_protocol, form.upstream_operation, form.adapter].join('\n');
	return <QuickTestContent key={key} {...props} />;
}

function QuickTestContent({
	formData: form,
	selectedModel,
	selectedProvider,
	selectedModelIsImage: isImage,
	selectedModelIsAudio: isAudio,
}: Props) {
	const t = useTranslations('routes.modal.quickTest');
	const family = quickTestLlmFamily(form, isImage || isAudio);
	const [sampleId, setSampleId] = useState<PlaygroundLlmSampleId>('connectivity');
	const [geminiStream, setGeminiStream] = useState(true);
	const [mobilePane, setMobilePane] = useState<'request' | 'response'>('request');
	const imageOperation =
		form.request_operation === 'images.edits' || form.upstream_operation === 'images.edits'
			? 'edits'
			: 'generations';
	const realtime = isDashScopeRealtimeOperation(form.upstream_operation);
	const needsAudioFile =
		isAudio &&
		isAudioTranscriptionModel(selectedModel ?? {}) &&
		form.adapter !== 'dashscope-asr-file-async' &&
		form.upstream_operation !== 'audio.transcriptions.multimodal' &&
		!realtime;
	const needsImageFiles = isImage && imageOperation === 'edits';
	const sample = useMemo(
		() =>
			templateForRoute(
				{
					...form,
					id: 'draft',
					status: 'active',
					price_override: null,
					custom_params: null,
					model_name: null,
					provider_name: null,
				} satisfies RouteListRow,
				selectedModel,
				imageOperation
			),
		[form, selectedModel, imageOperation]
	);
	const [bodyText, setBodyText] = useState(sample);
	const parsedBody = useMemo(() => {
		try {
			const value: unknown = JSON.parse(bodyText);
			return value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: null;
		} catch {
			return null;
		}
	}, [bodyText]);
	const streamingRequest = family === 'gemini' ? geminiStream : parsedBody?.stream === true;
	const activeSample =
		family && parsedBody
			? PLAYGROUND_LLM_SAMPLE_IDS.find(
					(id) =>
						JSON.stringify(JSON.parse(quickTestSample(form, family, id, streamingRequest))) ===
						JSON.stringify(parsedBody)
			  ) ?? 'custom'
			: 'custom';
	function applySample(id: PlaygroundLlmSampleId) {
		if (!family) return;
		setSampleId(id);
		setBodyText(quickTestSample(form, family, id, parsedBody ? streamingRequest : true));
		setError('');
	}
	const [files, setFiles] = useState<File[]>([]);
	const [sending, setSending] = useState(false);
	const [stopped, setStopped] = useState(false);
	const [error, setError] = useState('');
	const [responseText, setResponseText] = useState('');
	const [meta, setMeta] = useState<ResponseMeta | null>(null);
	const [wireBody, setWireBody] = useState<string | null>(null);
	const [wireHeaders, setWireHeaders] = useState<Record<string, string> | null>(null);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [sentFingerprint, setSentFingerprint] = useState('');
	const controllerRef = useRef<AbortController | null>(null);
	let draft: PlaygroundRouteDraft | null = null;
	let configError = '';
	try {
		if (!form.model_id || !form.provider_id || !form.provider_model_name.trim()) {
			configError = t('missingFields');
		} else {
			draft = {
				model_id: form.model_id,
				provider_id: form.provider_id,
				provider_model_name: form.provider_model_name,
				request_protocol: form.request_protocol,
				request_operation: form.request_operation,
				upstream_protocol: form.upstream_protocol,
				upstream_operation: form.upstream_operation,
				adapter: form.adapter,
				custom_params: composeCustomParamsJson(form.custom_params_json, form.custom_headers, {
					headers: form.custom_params_force_override_headers,
					body: form.custom_params_force_override_body,
				}),
			};
		}
	} catch (e) {
		configError = e instanceof Error ? e.message : t('invalidJson');
	}
	const configFingerprint = JSON.stringify(draft) + configError;
	const fingerprint =
		configFingerprint +
		bodyText +
		geminiStream +
		files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');
	const stale = Boolean(sentFingerprint && sentFingerprint !== fingerprint);
	useEffect(
		() => () => {
			controllerRef.current?.abort();
		},
		[configFingerprint]
	);
	useEffect(
		() => () => {
			controllerRef.current?.abort();
			controllerRef.current = null;
		},
		[]
	);
	useEffect(
		() => () => {
			if (audioUrl) URL.revokeObjectURL(audioUrl);
		},
		[audioUrl]
	);

	const preview = useMemo(
		() =>
			previewPlaygroundResponse(
				responseText,
				normalizeProtocol(form.upstream_protocol),
				meta?.contentType ?? null,
				!sending && !stopped
			),
		[responseText, form.upstream_protocol, meta?.contentType, sending, stopped]
	);
	const mergedRequest = previewPlaygroundMergedBody({
		bodyText,
		customParams: draft?.custom_params,
		upstreamProtocol: form.upstream_protocol,
		providerModelName: form.provider_model_name,
	});
	const plannedStreaming =
		family === 'gemini'
			? geminiStream
			: mergedRequest.status === 'preview' && JSON.parse(mergedRequest.json).stream === true;
	const showStream = meta ? preview.streaming : Boolean(family && plannedStreaming);
	const targetUrl = previewPlaygroundUpstreamUrl({
		provider: selectedProvider,
		upstreamProtocol: form.upstream_protocol,
		upstreamOperation: form.upstream_operation,
		providerModelName: form.provider_model_name,
		isImageModel: isImage,
		isAudioModel: isAudio,
		imageOperation,
		geminiAction: geminiStream ? 'streamGenerateContent' : 'generateContent',
	});
	const actualBody =
		wireBody ?? (family && !configError && mergedRequest.status === 'preview' ? mergedRequest.json : null);

	const images = useMemo(
		() => (isImage ? parseImagesGenerationsResponse(responseText).images : []),
		[isImage, responseText]
	);

	async function send() {
		if (controllerRef.current || !draft || configError || realtime) return;
		let body: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(bodyText);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
			body = parsed as Record<string, unknown>;
		} catch {
			setError(t('invalidJson'));
			return;
		}
		setError('');
		setStopped(false);
		setResponseText('');
		setMeta(null);
		setWireBody(null);
		setWireHeaders(null);
		setAudioUrl(null);
		setSentFingerprint(fingerprint);
		setSending(true);
		const controller = new AbortController();
		controllerRef.current = controller;
		const current = () => controllerRef.current === controller;
		try {
			if (needsAudioFile) {
				const validation = validateAudioTranscriptionFile(files[0] ?? null);
				if (!validation.ok) throw new Error(validation.error);
				body.file = await readFileAsDataUrl(files[0]);
				body.file_name = files[0].name;
			} else if (needsImageFiles) {
				const validation = validateEditImageFiles(files);
				if (!validation.ok) throw new Error(validation.error);
				body.images = await Promise.all(files.map(readFileAsDataUrl));
			}
			controller.signal.throwIfAborted();
			const res = await fetch('/api/admin/playground', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({
					routeDraft: draft,
					body,
					imageOperation,
					...(form.upstream_protocol === 'gemini'
						? { geminiAction: geminiStream ? 'streamGenerateContent' : 'generateContent' }
						: {}),
				}),
			});
			if (!current()) return;
			const contentType = res.headers.get('content-type') ?? '';
			setMeta({
				status: res.status,
				latencyMs: res.headers.get('x-playground-latency-ms'),
				upstreamUrl: res.headers.get('x-playground-upstream-url'),
				contentType,
			});
			setWireBody(decodeWireRequestBodyHeader(res, t('decodeFailed')));
			setWireHeaders(decodePlaygroundRequestHeadersHeader(res));
			if (res.ok && (contentType.startsWith('audio/') || contentType.includes('application/octet-stream'))) {
				const blob = await res.blob();
				if (current() && !controller.signal.aborted) setAudioUrl(URL.createObjectURL(blob));
				return;
			}
			let text = await readPlaygroundTextStream(res, (value) => {
				if (current()) setResponseText(value);
			});
			const mode = inferPlaygroundParseMode(contentType);
			if (mode !== 'sse' && mode !== 'ndjson') {
				try {
					text = JSON.stringify(JSON.parse(text), null, 2);
				} catch {
					/* Plain text */
				}
			}
			if (current()) setResponseText(text);
		} catch (e) {
			if (!current()) return;
			if (controller.signal.aborted) setStopped(true);
			else setError(e instanceof Error ? e.message : t('failed'));
		} finally {
			if (current()) {
				controllerRef.current = null;
				setSending(false);
			}
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<div className="flex shrink-0 items-center justify-between gap-3">
				<p className="min-w-0 truncate text-xs text-gray-500" title={t('hint')}>
					{t('hint')}
				</p>
				{sending ? (
					<button
						type="button"
						onClick={() => controllerRef.current?.abort()}
						className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
					>
						<StopIcon className="h-4 w-4" />
						{t('stop')}
					</button>
				) : (
					<button
						type="button"
						onClick={send}
						disabled={Boolean(configError) || realtime}
						className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						<PlayIcon className="h-4 w-4" />
						{t('send')}
					</button>
				)}
			</div>
			{configError || realtime ? (
				<p role="status" className="max-h-16 shrink-0 overflow-y-auto text-xs text-amber-700">
					{realtime ? t('realtimeHint') : configError}
				</p>
			) : null}
			<div className="flex shrink-0 gap-1 rounded-lg bg-slate-200/60 p-1 md:hidden">
				{(['request', 'response'] as const).map((pane) => (
					<button
						key={pane}
						type="button"
						aria-pressed={mobilePane === pane}
						onClick={() => setMobilePane(pane)}
						className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
							mobilePane === pane ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'
						}`}
					>
						{t(pane)}
					</button>
				))}
			</div>
			<div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-3 md:grid-cols-2">
				<div className="contents">
					<section
						className={`${editorPanelClass} min-h-0 flex-col overflow-hidden md:col-start-1 ${
							mobilePane === 'request' ? 'flex' : 'hidden md:flex'
						}`}
					>
						<RouteEditorSectionHeader
							title={t('request')}
							className="shrink-0"
							action={
								<button
									type="button"
									disabled={sending}
									onClick={() => {
										if (family) applySample(sampleId);
										else setBodyText(sample);
										setError('');
									}}
									className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
								>
									{t('reset')}
								</button>
							}
						/>
						<div className="flex min-h-0 flex-1 flex-col px-4 py-3">
							{family ? (
								<div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
									<label className="flex min-w-0 items-center gap-2 text-xs text-gray-500">
										<span className="shrink-0">{t('template')}</span>
										<select
											aria-label={t('template')}
											value={activeSample}
											disabled={sending}
											onChange={(e) => applySample(e.target.value as PlaygroundLlmSampleId)}
											className="min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-blue-500"
										>
											<option value="custom" disabled>
												{t('templateCustom')}
											</option>
											{PLAYGROUND_LLM_SAMPLE_IDS.map((id) => (
												<option key={id} value={id}>
													{t(`templates.${id}`)}
												</option>
											))}
										</select>
									</label>
									<label className="flex items-center gap-1.5 text-xs text-gray-600">
										<input
											type="checkbox"
											checked={streamingRequest}
											disabled={sending || !parsedBody}
											onChange={(e) => {
												if (family === 'gemini') setGeminiStream(e.target.checked);
												else setBodyText(setQuickTestStreaming(bodyText, family, e.target.checked));
											}}
											className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
										/>
										{t('streaming')}
									</label>
								</div>
							) : null}

							<div
								className="mb-2 shrink-0 truncate font-mono text-[11px] text-gray-500"
								title={`${form.upstream_protocol} / ${form.upstream_operation} · ${form.provider_model_name}`}
							>
								{form.upstream_protocol} / {form.upstream_operation} <span className="text-gray-300">·</span>{' '}
								{form.provider_model_name || '—'}
							</div>
							<textarea
								aria-label={t('request')}
								value={bodyText}
								onChange={(e) => {
									setBodyText(e.target.value);
									setError('');
								}}
								disabled={sending}
								spellCheck={false}
								className="block min-h-0 w-full flex-1 resize-none overflow-auto overscroll-contain rounded-lg border border-gray-200 bg-slate-50/60 p-3 font-mono text-xs leading-6 text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:opacity-60"
							/>
							{needsAudioFile || needsImageFiles ? (
								<label className="mt-2 block shrink-0 text-xs text-gray-600">
									{needsAudioFile ? t('audioFile') : t('imageFiles')}
									<input
										type="file"
										accept={needsAudioFile ? 'audio/*' : 'image/png,image/jpeg,image/webp'}
										multiple={needsImageFiles}
										disabled={sending}
										onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
										className="mt-2 block w-full text-xs"
									/>
								</label>
							) : null}
							{error ? (
								<p
									role="alert"
									className="mt-2 max-h-16 shrink-0 overflow-y-auto break-words text-xs text-red-700"
								>
									{error}
								</p>
							) : null}
						</div>
					</section>
					<section
						className={`${editorPanelClass} row-start-2 min-h-0 flex-col overflow-hidden md:col-start-1 ${
							mobilePane === 'request' ? 'flex' : 'hidden md:flex'
						}`}
					>
						<RouteEditorSectionHeader
							title={t('actualRequest')}
							className="shrink-0"
							action={
								<span
									className="whitespace-nowrap text-xs text-gray-400"
									title={
										wireBody ? (stale ? t('lastRequestHint') : t('sentRequestHint')) : t('requestPreviewHint')
									}
								>
									{wireBody ? t('sentRequest') : t('requestPreview')}
								</span>
							}
						/>
						<div
							tabIndex={0}
							aria-label={t('actualRequest')}
							className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-3 text-xs text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
						>
							{wireBody && stale ? <p className="mb-2 text-amber-700">{t('lastRequestHint')}</p> : null}
							{(wireBody ? meta?.upstreamUrl : targetUrl) ? (
								<p className="mb-3 break-all font-mono text-[11px]">
									<span className="mr-2 font-semibold">POST</span>
									{wireBody ? meta?.upstreamUrl : targetUrl}
								</p>
							) : null}
							{wireHeaders ? (
								<details className="mb-3 border-b border-gray-100 pb-3">
									<summary className="cursor-pointer">{t('requestHeaders')}</summary>
									<pre className="mt-2 whitespace-pre-wrap break-words font-mono leading-5">
										{Object.entries(wireHeaders)
											.map(([name, value]) => `${name}: ${value}`)
											.join('\n')}
									</pre>
								</details>
							) : null}
							{actualBody ? (
								<pre className="whitespace-pre-wrap break-words font-mono leading-6 text-gray-700">
									{actualBody}
								</pre>
							) : (
								<p className="py-6 text-center text-gray-400">{t('actualRequestEmpty')}</p>
							)}
						</div>
					</section>
				</div>
				<RouteTestOutput
					visibleOnMobile={mobilePane === 'response'}
					meta={meta}
					sending={sending}
					stopped={stopped}
					stale={stale}
					responseText={responseText}
					audioUrl={audioUrl}
					images={images}
					preview={preview}
					showStream={showStream}
				/>
			</div>
		</div>
	);
}
