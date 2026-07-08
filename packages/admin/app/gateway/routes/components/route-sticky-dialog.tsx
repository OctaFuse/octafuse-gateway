'use client';

import { STICKY_DEFAULT_SHORT_WAIT_MS, STICKY_DEFAULT_TTL_SECONDS } from '@octafuse/core/db/model-sticky-config';
import { useTranslations } from 'next-intl';
import type { StickyDialogState, StickyFormState } from '../types';

type Props = {
	dialog: StickyDialogState;
	form: StickyFormState;
	error: string;
	saving: boolean;
	onClose: () => void;
	onFormChange: (form: StickyFormState) => void;
	onSave: () => void;
};

export function RouteStickyDialog(props: Props) {
	const { dialog, form, error, saving, onClose, onFormChange, onSave } = props;
	const t = useTranslations('routes.sticky');
	const tCommon = useTranslations('common');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div
				className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="sticky-dialog-title"
			>
				<div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
					<div>
						<h2 id="sticky-dialog-title" className="text-base font-semibold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">{dialog.group}</span>
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>
				<div className="space-y-4 px-5 py-5">
					{error && (
						<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{error}
						</div>
					)}
					<label className="flex items-start gap-2.5">
						<input
							type="checkbox"
							checked={form.enabled}
							onChange={(e) => onFormChange({ ...form, enabled: e.target.checked })}
							className="mt-0.5 h-4 w-4 rounded border-gray-300 text-violet-600 focus:ring-2 focus:ring-violet-500 focus:ring-offset-1"
						/>
						<span className="text-sm text-gray-800">
							<span className="font-medium">{t('enable')}</span>
							<span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{t('enableHint')}</span>
						</span>
					</label>
					<div className={`grid grid-cols-2 gap-3 ${form.enabled ? '' : 'opacity-50'}`}>
						<div>
							<label className="mb-1 block text-sm font-medium text-gray-700">{t('idleTtl')}</label>
							<input
								type="number"
								min={1}
								value={form.ttl_seconds}
								onChange={(e) => onFormChange({ ...form, ttl_seconds: e.target.value })}
								disabled={!form.enabled}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
								placeholder={t('defaultPlaceholder', { value: STICKY_DEFAULT_TTL_SECONDS })}
							/>
						</div>
						<div>
							<label className="mb-1 block text-sm font-medium text-gray-700">{t('shortWait')}</label>
							<input
								type="number"
								min={1}
								value={form.short_wait_ms}
								onChange={(e) => onFormChange({ ...form, short_wait_ms: e.target.value })}
								disabled={!form.enabled}
								className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50"
								placeholder={t('defaultPlaceholder', { value: STICKY_DEFAULT_SHORT_WAIT_MS })}
							/>
						</div>
					</div>
					<p className="text-xs leading-relaxed text-gray-500">{t('shortWaitHint')}</p>
				</div>
				<div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-5 py-3.5">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={saving}
						className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{saving ? tCommon('savingDots') : tCommon('save')}
					</button>
				</div>
			</div>
		</div>
	);
}
