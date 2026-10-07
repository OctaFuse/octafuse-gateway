'use client';

import { displayedProtectedUpstreamPaths } from '@octafuse/core/upstream-extra-fields';
import type { AdapterDescriptor } from '@octafuse/core/adapters/registry';
import { useTranslations } from 'next-intl';
import { buildOpenAiAdapterCallSample } from '../route-utils';

type Props = {
	descriptor: AdapterDescriptor;
	onOpenRequestTab: () => void;
};

function mappingLines(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function responseKind(descriptor: AdapterDescriptor): 'job' | 'websocket' | 'sse' | 'binary' | 'json' {
	if (descriptor.exchange === 'job') return 'job';
	if (descriptor.exchange === 'websocket' || descriptor.responsePayload === 'websocket') return 'websocket';
	if (descriptor.exchange === 'sse' || descriptor.responsePayload === 'sse') return 'sse';
	if (descriptor.responsePayload === 'binary') return 'binary';
	return 'json';
}

export function RouteAdapterGuide({ descriptor, onOpenRequestTab }: Props) {
	const t = useTranslations('routes.modal');
	const passthrough = descriptor.id === 'passthrough';
	const showExtra =
		!passthrough &&
		descriptor.request.protocol === 'openai' &&
		(descriptor.modality === 'image' || descriptor.modality === 'audio');
	const multipart = descriptor.requestPayload === 'multipart';
	const example = descriptor.extraBodyExample ? JSON.stringify(descriptor.extraBodyExample, null, 2) : null;
	const protectedFields = displayedProtectedUpstreamPaths(descriptor.protectedUpstreamPaths).join(', ');
	const mapping = mappingLines(t.raw(`adapterGuides.${descriptor.id}.mapping`));
	const sample = passthrough ? null : buildOpenAiAdapterCallSample(descriptor);
	const lossy = descriptor.lossyFeatures ?? [];
	const payloadKey = descriptor.requestPayload === 'multipart' ? 'multipart' : 'json';
	const callPath = descriptor.exchange === 'websocket' ? descriptor.publicPath : `POST ${descriptor.publicPath}`;

	return (
		<div className="mt-4 min-w-0 rounded-xl border border-slate-300/80 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
			<p className="text-xs font-medium text-gray-800">{t('guide.title')}</p>
			<section className="mt-3">
				<p className="text-xs font-medium text-gray-500">{t('guide.call')}</p>
				<p className="mt-1 break-all font-mono text-xs text-gray-800">{callPath}</p>
				<p className="mt-1 text-xs text-gray-600">
					{t(`guide.payload.${payloadKey}`)} · {t(`guide.response.${responseKind(descriptor)}`)} ·{' '}
					{t(`guide.billing.${descriptor.billing}`)}
				</p>
			</section>
			{passthrough ? <p className="mt-3 text-xs text-gray-600">{t('guide.passthrough')}</p> : null}
			{!passthrough && mapping.length > 0 ? (
				<section className="mt-3">
					<p className="text-xs font-medium text-gray-500">{t('guide.mapping')}</p>
					<ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-gray-700">
						{mapping.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				</section>
			) : null}
			{!passthrough && lossy.length > 0 ? (
				<p className="mt-3 text-xs text-amber-700">
					{t('adapterLossyFeatures', {
						features: lossy
							.map((feature) =>
								t.has(`lossyFeatureNames.${feature}`) ? t(`lossyFeatureNames.${feature}`) : feature,
							)
							.join(', '),
					})}
				</p>
			) : null}
			{showExtra ? (
				<section className="mt-3 rounded-md bg-gray-50 p-2 text-xs text-gray-600">
					<p className="font-medium text-gray-500">{t('guide.extra')}</p>
					<p className="mt-1">{multipart ? t('extraBodyMultipartHint') : t('extraBodyHint')}</p>
					{example ? (
						<pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-gray-700">
							{example}
						</pre>
					) : null}
					<p className="mt-2">{t('extraBodyProtected', { fields: protectedFields })}</p>
					{descriptor.extraBodyNote === 'dashscope_tts_input' ? (
						<>
							<p className="mt-2">{t('extraBodyInputLimit')}</p>
							<button
								type="button"
								onClick={onOpenRequestTab}
								className="mt-2 font-medium text-blue-700 hover:underline"
							>
								{t('guide.openRequest')}
							</button>
						</>
					) : null}
				</section>
			) : null}
			{sample ? (
				<section className="mt-3">
					<p className="text-xs font-medium text-gray-500">{t('guide.sample')}</p>
					<pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-gray-700">
						{sample}
					</pre>
				</section>
			) : null}
		</div>
	);
}
