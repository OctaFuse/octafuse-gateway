'use client';

import { useAdminDialog } from '@/components/use-admin-dialog';

import { useTranslations } from 'next-intl';

type Props = {
	open: boolean;
	onClose: () => void;
};

export function FailoverRulesDialog({ open, onClose }: Props) {
	const t = useTranslations('routes.failover');
	const tCommon = useTranslations('common');
	const dialogRef = useAdminDialog(open, false, onClose);

	if (!open) return null;

	const rules = [
		t('order'),
		t('sameLayer'),
		t('crossLayer'),
		t('attemptLimit'),
		t('circuitCooldown'),
		t('allBusy'),
		t('memoryNote'),
		t('imagesAbort'),
	] as const;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				className="flex max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none ring-1 ring-black/5"
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="failover-rules-dialog-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-3.5">
					<div>
						<h2 id="failover-rules-dialog-title" className="text-base font-medium text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-amber-700">{t('readonlyHint')}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>
				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
					<ol className="list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-gray-700">
						{rules.map((rule) => (
							<li key={rule}>{rule}</li>
						))}
					</ol>
				</div>
				<div className="flex shrink-0 justify-end border-t border-gray-200 bg-gray-50/60 px-5 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-md admin-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
					>
						{tCommon('close')}
					</button>
				</div>
			</div>
		</div>
	);
}
