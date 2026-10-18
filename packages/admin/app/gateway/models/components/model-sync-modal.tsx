'use client';

import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import type {
	ModelSyncField,
	ModelSyncModelEntry,
	ModelSyncPricingField,
	ModelSyncScalarField,
	ModelSyncVendorGroup,
} from '@/lib/model-sync-diff';
import { modelSyncSelectionKey, type ModelSyncState } from '../use-model-sync';

type ModelSyncModalProps = {
	sync: ModelSyncState;
};

const STATUS_STYLE: Record<string, string> = {
	added: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	changed: 'bg-amber-50 text-amber-800 ring-amber-200',
	removed: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function Value({ value, tone }: { value: string | null; tone: 'old' | 'new' | 'none' }) {
	if (value === null) return <span className="text-gray-300">—</span>;
	const toneClass =
		tone === 'old' ? 'bg-red-50 text-red-900' : tone === 'new' ? 'bg-emerald-50 text-emerald-900' : '';
	return (
		<span className={`break-all rounded px-1 py-0.5 font-mono text-[11px] leading-5 ${toneClass}`}>{value}</span>
	);
}

function ScalarDiff({ field }: { field: ModelSyncScalarField }) {
	const t = useTranslations('models.sync');
	return (
		<div className="grid gap-2 text-xs sm:grid-cols-2">
			<div className="min-w-0">
				<p className="mb-1 font-medium text-gray-500">{t('current')}</p>
				<p className="whitespace-pre-wrap break-words rounded-md border border-red-100 bg-red-50/60 p-2 text-gray-800">
					{field.current ?? <span className="text-gray-300">—</span>}
				</p>
			</div>
			<div className="min-w-0">
				<p className="mb-1 font-medium text-gray-500">{t('official')}</p>
				<p className="whitespace-pre-wrap break-words rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-gray-800">
					{field.official}
				</p>
			</div>
		</div>
	);
}

function PricingDiff({ field, currency }: { field: ModelSyncPricingField; currency: string }) {
	const t = useTranslations('models.sync');
	return (
		<div className="space-y-2">
			<p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
				<ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
				<span>{t('pricingHint', { currency })}</span>
			</p>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[32rem] table-fixed text-left text-xs">
					<thead>
						<tr className="text-gray-500">
							<th className="w-56 py-1 pr-2 font-medium">{t('pricingPath')}</th>
							<th className="py-1 pr-2 font-medium">{t('current')}</th>
							<th className="py-1 font-medium">{t('official')}</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100 align-top">
						{field.rows.map((row) => (
							<tr key={row.path}>
								<td className="py-1.5 pr-2 font-mono text-[11px] text-gray-600">
									<span className="break-all">{row.path}</span>
									{row.status === 'removed' ? (
										<span
											className={`ml-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${STATUS_STYLE.removed}`}
										>
											{t('status.removed')}
										</span>
									) : null}
								</td>
								<td className="py-1.5 pr-2">
									<Value value={row.current} tone={row.current === null ? 'none' : 'old'} />
								</td>
								<td className="py-1.5">
									<Value value={row.official} tone={row.official === null ? 'none' : 'new'} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function FieldBlock(props: {
	model: ModelSyncModelEntry;
	field: ModelSyncField;
	currency: string;
	apply: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	const { model, field, currency, apply, disabled, onToggle } = props;
	const t = useTranslations('models.sync');
	const title = t(`field.${field.key}`);

	const choose = (wantApply: boolean) => {
		if (wantApply !== apply) onToggle();
	};
	const segment = (active: boolean, tone: 'official' | 'keep') =>
		`px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 ${
			active
				? tone === 'official'
					? 'bg-blue-600 text-white'
					: 'bg-slate-700 text-white'
				: 'bg-white text-gray-600 hover:bg-gray-50'
		}`;

	return (
		<div
			className={`rounded-lg border p-3 ${apply ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white'}`}
		>
			<div className="mb-2 flex flex-wrap items-center gap-2">
				<h4 className="text-sm font-semibold text-gray-900">{title}</h4>
				<span
					className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLE[field.status]}`}
				>
					{t(`status.${field.status}`)}
				</span>
				<div
					role="radiogroup"
					aria-label={`${model.model_id} · ${title}`}
					className="ml-auto inline-flex overflow-hidden rounded-md border border-gray-300"
				>
					<button
						type="button"
						role="radio"
						aria-checked={apply}
						disabled={disabled}
						onClick={() => choose(true)}
						className={segment(apply, 'official')}
					>
						{t('useOfficial')}
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={!apply}
						disabled={disabled}
						onClick={() => choose(false)}
						className={`border-l border-gray-300 ${segment(!apply, 'keep')}`}
					>
						{t('keepCurrent')}
					</button>
				</div>
			</div>
			{field.key === 'pricing_profile' ? (
				<PricingDiff field={field} currency={currency} />
			) : (
				<ScalarDiff field={field} />
			)}
		</div>
	);
}

function ModelBlock(props: { sync: ModelSyncState; model: ModelSyncModelEntry; currency: string }) {
	const { sync, model, currency } = props;
	const t = useTranslations('models.sync');
	const tCard = useTranslations('models.card');
	const selectedCount = sync.selectedFieldsOf(model).length;

	return (
		<section className="rounded-xl border border-gray-200 bg-white shadow-sm">
			<header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
				<div className="min-w-0">
					<h3 className="truncate text-sm font-semibold text-gray-900">
						{model.display_name || model.model_id}
					</h3>
					<p className="truncate font-mono text-[11px] text-gray-500">{model.model_id}</p>
				</div>
				<span className="text-xs text-gray-500">
					{model.routes_count <= 0
						? tCard('noRoutes')
						: `${tCard(model.routes_count === 1 ? 'routes' : 'routesPlural', { count: model.routes_count })} · ${tCard('activeRoutes', { count: model.active_routes_count })}`}
				</span>
				<button
					type="button"
					onClick={() => void sync.runApply([model.model_id])}
					disabled={sync.submitting || selectedCount === 0}
					className="ml-auto rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
				>
					{t('applyModel', { count: selectedCount })}
				</button>
			</header>
			<div className="space-y-3 p-4">
				{model.fields.map((field) => (
					<FieldBlock
						key={field.key}
						model={model}
						field={field}
						currency={currency}
						apply={Boolean(sync.selection[modelSyncSelectionKey(model.model_id, field.key)])}
						disabled={sync.submitting}
						onToggle={() => sync.toggleField(model.model_id, field.key)}
					/>
				))}
			</div>
		</section>
	);
}

function GroupPanel(props: { sync: ModelSyncState; group: ModelSyncVendorGroup; currency: string }) {
	const { sync, group, currency } = props;
	const t = useTranslations('models.sync');
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<ModelVendorIcon vendor={group.vendor} size="compact" />
				<div className="min-w-0">
					<h3 className="truncate text-base font-semibold text-gray-900">{group.vendor_label}</h3>
					<p className="text-xs text-gray-500">{t('groupHint')}</p>
				</div>
				<div className="ml-auto flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => sync.setGroupFields(group, true)}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						{t('useOfficialAll')}
					</button>
					<button
						type="button"
						onClick={() => sync.setGroupFields(group, false)}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-50 disabled:opacity-50"
					>
						{t('keepCurrentAll')}
					</button>
				</div>
			</div>
			{group.models.map((model) => (
				<ModelBlock key={model.model_id} sync={sync} model={model} currency={currency} />
			))}
		</div>
	);
}

export function ModelSyncModal({ sync }: ModelSyncModalProps) {
	const t = useTranslations('models.sync');
	const tCommon = useTranslations('common');

	if (!sync.open) return null;

	const report = sync.report;
	const hasAnything = Boolean(report && report.groups.length > 0);
	const activeGroup =
		report && sync.activeVendor ? report.groups.find((g) => g.vendor === sync.activeVendor) : undefined;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !sync.submitting) sync.close();
			}}
		>
			<div
				className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-sync-title"
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b px-6 py-4">
					<div>
						<h2 id="model-sync-title" className="text-xl font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">{t('subtitle')}</p>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => void sync.reload()}
							disabled={sync.loading || sync.submitting}
							className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
							aria-label={t('recheck')}
							title={t('recheck')}
						>
							<ArrowPathIcon className={`h-5 w-5 ${sync.loading ? 'animate-spin' : ''}`} aria-hidden />
						</button>
						<button
							type="button"
							onClick={sync.close}
							disabled={sync.submitting}
							className="px-2 text-2xl leading-none text-gray-400 hover:text-gray-600 disabled:opacity-50"
							aria-label={tCommon('close')}
						>
							×
						</button>
					</div>
				</div>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					{hasAnything && report ? (
						<nav
							className="max-h-48 shrink-0 overflow-y-auto border-b bg-gray-50 p-2 md:max-h-none md:w-72 md:border-b-0 md:border-r"
							aria-label={t('navAria')}
						>
							<ul className="space-y-1">
								{report.groups.map((group) => {
									const fieldCount = group.models.reduce((n, m) => n + m.fields.length, 0);
									const active = sync.activeVendor === group.vendor;
									return (
										<li key={group.vendor}>
											<button
												type="button"
												onClick={() => sync.setActiveVendor(group.vendor)}
												aria-current={active ? 'true' : undefined}
												className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
													active ? 'bg-blue-100 text-blue-900' : 'text-gray-700 hover:bg-gray-100'
												}`}
											>
												<ModelVendorIcon vendor={group.vendor} size="compact" />
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">{group.vendor_label}</span>
													<span className="block text-[11px] text-gray-500">
														{t('groupSummary', { models: group.models.length, fields: fieldCount })}
													</span>
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						</nav>
					) : null}

					<div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/50 px-6 py-5">
						{sync.loading && !report ? (
							<div className="py-16 text-center text-gray-600">{t('loading')}</div>
						) : null}
						{sync.error ? (
							<div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
								{sync.error}
							</div>
						) : null}
						{report && !sync.error && !hasAnything ? (
							<div className="flex flex-col items-center gap-3 py-16 text-center">
								<CheckCircleIcon className="h-12 w-12 text-emerald-500" aria-hidden />
								<p className="text-base font-medium text-gray-900">{t('allSyncedTitle')}</p>
								<p className="max-w-md text-sm text-gray-500">{t('allSyncedHint')}</p>
							</div>
						) : null}
						{report && activeGroup ? (
							<GroupPanel sync={sync} group={activeGroup} currency={report.billing_currency} />
						) : null}
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-gray-50 px-6 py-4">
					<div className="min-w-0 flex-1 text-sm text-gray-600">
						<p>
							{t('summary', { fields: sync.totals.fields, models: sync.totals.models })}
							{sync.totals.pricing > 0 ? (
								<span className="ml-1 text-amber-700">
									{t('summaryPricing', { models: sync.totals.pricing, routes: sync.totals.activeRoutes })}
								</span>
							) : null}
						</p>
						<p className="mt-0.5 text-xs text-gray-400">{t('safeNote')}</p>
					</div>
					{report && report.groups.length > 0 ? (
						<button
							type="button"
							onClick={sync.resetToDefaults}
							disabled={sync.submitting}
							className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
						>
							{t('resetDefaults')}
						</button>
					) : null}
					<button
						type="button"
						onClick={sync.close}
						disabled={sync.submitting}
						className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-white disabled:opacity-50"
					>
						{tCommon('close')}
					</button>
					<button
						type="button"
						onClick={() => void sync.runApply()}
						disabled={sync.submitting || sync.loading || sync.totals.fields === 0}
						className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{sync.submitting ? t('applying') : t('applyAll', { count: sync.totals.models })}
					</button>
				</div>
			</div>
		</div>
	);
}
