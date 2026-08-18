'use client';

import { useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import type { RouteStrategyName } from '@octafuse/core';
import { isRouteStrategyName } from '@octafuse/core/db/model-route-policy';
import { useTranslations } from 'next-intl';
import { getRouteStrategyMeta } from '../routes/route-strategy-meta';
import { RouteStrategyDiagram } from '../routes/components/route-strategy-diagram';
import { RouteStrategyPicker } from '../routes/components/route-strategy-picker';

type Props = {
	value: string;
	saving: boolean;
	onSave: (value: string) => Promise<boolean>;
};

export function GlobalRouteStrategySection({ value, saving, onSave }: Props) {
	const t = useTranslations('config.routeStrategy');
	const tStrategy = useTranslations('routes.strategy');
	const tCommon = useTranslations('common');
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(value);

	const meta = getRouteStrategyMeta(value);
	const title = isRouteStrategyName(value)
		? tStrategy(`display.${value as RouteStrategyName}`)
		: value;

	const openDialog = () => {
		setDraft(value);
		setOpen(true);
	};

	const handleSave = async () => {
		const ok = await onSave(draft);
		if (ok) setOpen(false);
	};

	return (
		<>
			<div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3.5">
				<div className="flex items-start gap-3">
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-semibold text-gray-900">{title}</span>
							<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
								{tStrategy('effective')}
							</span>
						</div>
						{meta ? (
							<p className="mt-0.5 font-mono text-[10px] text-gray-400">{meta.machineId}</p>
						) : null}
						<p className="mt-2 text-xs leading-relaxed text-gray-600">
							{isRouteStrategyName(value) ? tStrategy(`description.${value}.summary`) : null}
						</p>
						<button
							type="button"
							onClick={openDialog}
							disabled={saving}
							className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<PencilSquareIcon className="h-4 w-4" />
							{t('change')}
						</button>
					</div>
					{meta ? (
						<div className="hidden w-44 shrink-0 sm:block">
							<RouteStrategyDiagram
								kind={meta.diagram}
								active
								caption={tStrategy(`diagramCaption.${meta.id}`)}
							/>
						</div>
					) : null}
				</div>
			</div>

			{open ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
					onMouseDown={(event) => {
						if (event.target === event.currentTarget && !saving) setOpen(false);
					}}
				>
					<div
						className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
						role="dialog"
						aria-modal="true"
						aria-labelledby="global-route-strategy-dialog-title"
					>
						<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
							<div>
								<h2
									id="global-route-strategy-dialog-title"
									className="text-base font-semibold text-gray-900"
								>
									{t('title')}
								</h2>
								<p className="mt-1 text-xs text-gray-500">{t('dialogHint')}</p>
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								disabled={saving}
								className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
								aria-label={tCommon('close')}
							>
								<span className="block text-xl leading-none" aria-hidden>
									×
								</span>
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
							<RouteStrategyPicker
								value={draft}
								onChange={setDraft}
								disabled={saving}
								dense
							/>
						</div>
						<div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-6 py-4">
							<button
								type="button"
								onClick={() => setOpen(false)}
								disabled={saving}
								className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{tCommon('cancel')}
							</button>
							<button
								type="button"
								onClick={() => void handleSave()}
								disabled={saving || draft === value}
								className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{saving ? tCommon('saving') : tCommon('save')}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
