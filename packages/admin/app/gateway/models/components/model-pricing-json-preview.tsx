'use client';

import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { formatCatalogPricingProfilePreview } from '@/lib/pricing-tiers-draft';

export function ModelPricingJsonPreview({
	preview,
}: {
	preview: ReturnType<typeof formatCatalogPricingProfilePreview>;
}) {
	const t = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const textRef = useRef<HTMLTextAreaElement>(null);
	const [result, setResult] = useState<{
		text: string;
		state: 'copied' | 'failed';
	} | null>(null);
	const state = result?.text === preview.text ? result.state : 'idle';
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(preview.text);
			setResult({ text: preview.text, state: 'copied' });
		} catch {
			textRef.current?.focus();
			textRef.current?.select();
			setResult({ text: preview.text, state: 'failed' });
		}
	};
	return (
		<div className="flex min-h-80 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200">
			<div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
				<div>
					<h3 className="text-sm font-semibold text-gray-800">
						{t('viewPricingProfileJson')}
					</h3>
					<p className="mt-1 text-xs leading-5 text-gray-500">
						{t('pricingJsonHint')}
					</p>
				</div>
				<button
					type="button"
					onClick={() => void copy()}
					disabled={!preview.ok}
					className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
				>
					{state === 'copied' ? (
						<CheckIcon className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
					) : (
						<ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />
					)}
					{state === 'copied' ? tCommon('copied') : tCommon('copy')}
				</button>
			</div>
			{state === 'failed' ? (
				<p role="status" className="px-4 pt-3 text-xs text-amber-700">
					{t('jsonCopyFailed')}
				</p>
			) : null}
			<textarea
				ref={textRef}
				readOnly
				spellCheck={false}
				aria-label={t('viewPricingProfileJson')}
				value={preview.text}
				className={`min-h-64 w-full flex-1 resize-none bg-gray-50/30 p-4 font-mono text-xs leading-6 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-200 ${
					preview.ok ? 'text-gray-800' : 'text-red-600'
				}`}
			/>
		</div>
	);
}
