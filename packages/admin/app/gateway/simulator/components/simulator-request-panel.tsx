'use client';

import { PaperAirplaneIcon, StopIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { RequestTargetUrl } from '@/components/request-target-url';
import { codeBlockClass, inputClass, labelClass, prettyJsonBody } from '../simulator-utils';
import type { WirePreview } from '../types';

type Props = {
	bodyText: string;
	onBodyTextChange: (v: string) => void;
	bodyDirty: boolean;
	onApplyTemplate: () => void;
	infoHint: string | null;
	bodyError: string | null;
	displayWire: WirePreview | null;
	wireOpen: boolean;
	onWireOpenChange: (open: boolean) => void;
	sending: boolean;
	canSend: boolean;
	sendBlockedHint: string | null;
	onSend: () => void;
	onStop: () => void;
};

export function SimulatorRequestPanel({
	bodyText,
	onBodyTextChange,
	bodyDirty,
	onApplyTemplate,
	infoHint,
	bodyError,
	displayWire,
	wireOpen,
	onWireOpenChange,
	sending,
	canSend,
	sendBlockedHint,
	onSend,
	onStop,
}: Props) {
	const t = useTranslations('simulator');
	const tCommon = useTranslations('common');

	return (
		<section className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3 flex flex-col min-h-0">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">{t('requestBody')}</h2>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onApplyTemplate}
						disabled={!bodyDirty || sending}
						className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{t('applyTemplate')}
					</button>
					{sending ? (
						<button
							type="button"
							onClick={onStop}
							className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700"
						>
							<StopIcon className="h-4 w-4" />
							{tCommon('stop')}
						</button>
					) : (
						<button
							type="button"
							onClick={onSend}
							disabled={!canSend}
							title={sendBlockedHint ?? undefined}
							className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							<PaperAirplaneIcon className="h-4 w-4" />
							{tCommon('send')}
						</button>
					)}
				</div>
			</div>
			{sendBlockedHint && !sending ? (
				<p className="text-xs text-gray-500 -mt-1">{sendBlockedHint}</p>
			) : null}
			{infoHint ? (
				<div className="p-2.5 bg-blue-50 border border-blue-200 rounded-md text-blue-900 text-sm">{infoHint}</div>
			) : null}
			<RequestTargetUrl
				label={t('requestTargetUrl')}
				method={displayWire?.method ?? 'POST'}
				url={displayWire?.url}
				emptyHint={t('requestTargetUrlEmpty')}
			/>
			<div className="flex-1 min-h-0 flex flex-col">
				<label className={labelClass}>JSON</label>
				<textarea
					value={bodyText}
					onChange={(e) => onBodyTextChange(e.target.value)}
					rows={12}
					className={`${inputClass} font-mono text-sm min-h-[180px] flex-1`}
					spellCheck={false}
				/>
			</div>
			{bodyError ? (
				<div className="p-2.5 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm">{bodyError}</div>
			) : null}

			<div className="border-t border-gray-100 pt-2">
				<button
					type="button"
					onClick={() => onWireOpenChange(!wireOpen)}
					className="flex w-full items-center justify-between text-left text-xs font-medium text-gray-600 hover:text-gray-900"
					aria-expanded={wireOpen}
				>
					<span>{t('wirePreview')}</span>
					<span className="text-gray-400">{wireOpen ? '▾' : '▸'}</span>
				</button>
				{wireOpen ? (
					displayWire ? (
						<div className="mt-2 space-y-2">
							<div className="text-xs text-gray-600">
								<span className="font-semibold text-gray-700">{displayWire.method}</span>{' '}
								<span className="font-mono break-all">{displayWire.url}</span>
							</div>
							<div>
								<div className="text-[11px] font-medium text-gray-500 mb-1">{t('wireHeaders')}</div>
								<pre className={codeBlockClass}>
									{Object.entries(displayWire.headers)
										.map(([k, v]) => `${k}: ${v}`)
										.join('\n')}
								</pre>
							</div>
							<div>
								<div className="text-[11px] font-medium text-gray-500 mb-1">{t('wireBody')}</div>
								<pre className={codeBlockClass}>{prettyJsonBody(displayWire.bodyText)}</pre>
							</div>
						</div>
					) : (
						<p className="mt-2 text-xs text-gray-500">{t('wirePreviewEmpty')}</p>
					)
				) : null}
			</div>
		</section>
	);
}
