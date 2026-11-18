'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeftIcon, ChevronRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { diffDefinitions, foldUnchanged, stableStringify, type DiffLine } from '../mcp-definition-diff';
import type { CatalogItem } from '../mcp-types';
import { McpDialog } from './mcp-dialog';

const KIND_LABEL = { tool: 'tools', prompt: 'prompts', resource: 'resources' } as const;

const LINE_STYLE: Record<DiffLine['kind'], string> = {
	same: 'text-gray-600',
	add: 'bg-emerald-50 text-emerald-900',
	del: 'bg-red-50 text-red-800',
};
const SIGN: Record<DiffLine['kind'], string> = { same: ' ', add: '+', del: '−' };

function DiffView({ item }: { item: CatalogItem }) {
	const t = useTranslations('mcp');
	const [expandedAll, setExpandedAll] = useState(false);
	const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(new Set());
	const diff = useMemo(() => diffDefinitions(item.definition, item.pendingDefinition), [item]);
	const blocks = useMemo(() => foldUnchanged(diff.lines, 3), [diff.lines]);
	const hasGap = blocks.some((block) => block.type === 'gap');

	if (diff.added === 0 && diff.removed === 0) {
		return <p className="rounded-lg bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-500">{t('diffNoChanges')}</p>;
	}

	const row = (line: DiffLine, key: string) => (
		<div key={key} className={`flex min-w-0 ${LINE_STYLE[line.kind]}`}>
			<span className="w-9 shrink-0 select-none px-1 text-right text-gray-400">{line.oldNo ?? ''}</span>
			<span className="w-9 shrink-0 select-none px-1 text-right text-gray-400">{line.newNo ?? ''}</span>
			<span className="w-4 shrink-0 select-none text-center">{SIGN[line.kind]}</span>
			<span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">{line.text}</span>
		</div>
	);

	return (
		<div>
			<div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
				<span className="text-gray-500">{t('reviewChangedFields')}</span>
				{diff.fields.map((field) => (
					<code key={field} className="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-sky-800">
						{field}
					</code>
				))}
				<span className="font-mono text-gray-500">
					<span className="text-emerald-700">+{diff.added}</span> <span className="text-red-700">−{diff.removed}</span>
				</span>
				{hasGap ? (
					<button
						type="button"
						onClick={() => setExpandedAll((value) => !value)}
						className="ml-auto font-medium text-gray-600 hover:text-gray-900"
					>
						{t(expandedAll ? 'diffCollapse' : 'diffExpandAll')}
					</button>
				) : null}
			</div>
			<div className="max-h-[52vh] overflow-auto rounded-lg border border-gray-200 bg-white py-1 font-mono text-xs leading-5">
				{blocks.map((block, index) =>
					block.type === 'lines' || expandedAll || openGaps.has(index) ? (
						block.lines.map((line, lineIndex) => row(line, `${index}:${lineIndex}`))
					) : (
						<button
							key={`gap:${index}`}
							type="button"
							onClick={() => setOpenGaps((current) => new Set(current).add(index))}
							className="block w-full bg-gray-50 px-3 py-1 text-left text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						>
							⋯ {t('diffUnchangedLines', { count: block.lines.length })}
						</button>
					)
				)}
			</div>
		</div>
	);
}

/**
 * Walks the operator through every pending catalog item (changed definitions and new items) one at a time.
 * The queue is the live `items` prop: accepting or enabling an item removes it upstream of this component,
 * so the cursor simply stays on the same position and lands on the next item.
 */
export function McpReviewDialog({
	serverSlug,
	items,
	startId,
	busy,
	onClose,
	onAccept,
	onEnable,
	onAcceptAll,
}: {
	/** Exposed names are `<slug>__<name>`; the queue drops the shared prefix so the names stay distinguishable. */
	serverSlug: string;
	items: CatalogItem[];
	startId: string | null;
	busy: boolean;
	onClose: () => void;
	onAccept: (id: string) => Promise<boolean>;
	onEnable: (id: string) => Promise<boolean>;
	onAcceptAll: (ids: string[]) => Promise<boolean>;
}) {
	const t = useTranslations('mcp');
	const common = useTranslations('common');
	const [currentId, setCurrentId] = useState<string | null>(startId ?? items[0]?.id ?? null);
	const lastIndex = useRef(0);
	const index = items.findIndex((item) => item.id === currentId);
	const current = index >= 0 ? items[index] : null;

	// The current item left the queue (accepted / enabled, here or elsewhere): stay on the same position.
	useEffect(() => {
		if (index >= 0) {
			lastIndex.current = index;
		} else if (items.length) {
			setCurrentId(items[Math.min(lastIndex.current, items.length - 1)].id);
		}
	}, [index, items]);

	const go = (target: number) => {
		const next = items[Math.min(Math.max(target, 0), items.length - 1)];
		if (next) setCurrentId(next.id);
	};

	// ← / → move through the queue (ignored while typing or when a confirmation sits above the dialog).
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			if (document.querySelector('[role="alertdialog"]')) return;
			const target = event.target;
			if (target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')) return;
			const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
			if (!step || index < 0) return;
			const next = items[index + step];
			if (!next) return;
			event.preventDefault();
			setCurrentId(next.id);
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [index, items]);

	const shortName = (item: CatalogItem) =>
		item.exposedName.startsWith(`${serverSlug}__`) ? item.exposedName.slice(serverSlug.length + 2) : item.exposedName;
	const changedIds = items.filter((item) => item.reviewState === 'changed').map((item) => item.id);
	const isChanged = current?.reviewState === 'changed';
	const description = current?.definition?.description || current?.definition?.title || t('noDescription');

	const navigation = (
		<div className="flex items-center gap-1">
			<button
				type="button"
				aria-label={t('reviewPrev')}
				title={`${t('reviewPrev')} (←)`}
				disabled={index <= 0}
				onClick={() => go(index - 1)}
				className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
			>
				<ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
			</button>
			<span className="min-w-[4rem] text-center font-mono text-xs text-gray-500">
				{items.length ? t('reviewPosition', { index: index + 1, total: items.length }) : '—'}
			</span>
			<button
				type="button"
				aria-label={t('reviewNext')}
				title={`${t('reviewNext')} (→)`}
				disabled={index < 0 || index >= items.length - 1}
				onClick={() => go(index + 1)}
				className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
			>
				<ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
			</button>
		</div>
	);

	const footer = current ? (
		<div className="flex flex-wrap items-center justify-between gap-3">
			{navigation}
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					disabled={busy || items.length < 2}
					onClick={() => go(index < items.length - 1 ? index + 1 : 0)}
					className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
				>
					{t('reviewSkip')}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => void (isChanged ? onAccept(current.id) : onEnable(current.id))}
					className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
				>
					{isChanged ? t('accept') : t('enable')}
				</button>
			</div>
		</div>
	) : (
		<div className="flex justify-end">
			<button
				type="button"
				onClick={onClose}
				className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
			>
				{common('close')}
			</button>
		</div>
	);

	return (
		<McpDialog
			width="wide"
			title={t('reviewDialogTitle')}
			subtitle={items.length ? t('pendingBadge', { count: items.length }) : undefined}
			busy={busy}
			closeWhileBusy
			onClose={onClose}
			footer={footer}
		>
			{!current ? (
				<div role="status" className="flex flex-col items-center gap-2 py-16 text-center">
					<CheckCircleIcon className="h-10 w-10 text-emerald-500" aria-hidden="true" />
					<p className="text-base font-medium text-gray-900">{t('reviewDone')}</p>
					<p className="text-sm text-gray-500">{t('reviewDoneHint')}</p>
				</div>
			) : (
				<div className="grid min-h-[22rem] gap-5 md:grid-cols-[15rem_minmax(0,1fr)]">
					<aside className="min-w-0">
						<h3 className="mb-2 text-xs font-medium text-gray-500">{t('reviewQueue')}</h3>
						<ul className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
							{items.map((item) => (
								<li key={item.id}>
									<button
										type="button"
										aria-current={item.id === current.id}
										onClick={() => setCurrentId(item.id)}
										className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left ${
											item.id === current.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
										}`}
									>
										<span
											className={`h-1.5 w-1.5 shrink-0 rounded-full ${
												item.reviewState === 'changed' ? 'bg-sky-500' : 'bg-amber-500'
											}`}
											aria-hidden="true"
										/>
										<span className="min-w-0 flex-1 truncate font-mono text-xs" title={item.exposedName}>
											{shortName(item)}
										</span>
										<span
											className={`shrink-0 text-xs ${item.id === current.id ? 'text-gray-300' : 'text-gray-400'}`}
										>
											{item.reviewState === 'changed' ? t('reviewChanged') : t('reviewNew')}
										</span>
									</button>
								</li>
							))}
						</ul>
						{changedIds.length > 1 ? (
							<button
								type="button"
								disabled={busy}
								onClick={() => void onAcceptAll(changedIds)}
								className="mt-3 text-xs font-medium text-gray-800 hover:underline disabled:opacity-50"
							>
								{t('acceptAllChanges', { count: changedIds.length })}
							</button>
						) : null}
					</aside>
					<section key={current.id} className="min-w-0 space-y-4" aria-live="polite">
						<div>
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="break-all font-mono text-sm font-medium text-gray-900">{current.exposedName}</h3>
								<span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
									{t(KIND_LABEL[current.kind])}
								</span>
								<span
									className={`rounded-md px-2 py-0.5 text-xs font-medium ${
										isChanged ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'
									}`}
								>
									{isChanged ? t('reviewChanged') : t('reviewNew')}
								</span>
							</div>
							<p className="mt-1 text-xs leading-5 text-gray-500">
								{isChanged ? t('reviewChangedNote') : t('reviewNewNote')}
							</p>
						</div>
						{isChanged && current.pendingDefinition ? (
							<DiffView item={current} />
						) : (
							<div className="space-y-3">
								<p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">{description}</p>
								<div>
									<p className="mb-1 text-xs font-medium text-gray-500">{t('reviewDefinition')}</p>
									<pre className="max-h-[40vh] overflow-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
										{stableStringify(current.definition)}
									</pre>
								</div>
							</div>
						)}
					</section>
				</div>
			)}
		</McpDialog>
	);
}
