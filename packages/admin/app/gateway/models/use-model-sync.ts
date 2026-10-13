'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeedback } from '@/components/feedback';
import type {
	ModelSyncField,
	ModelSyncModelEntry,
	ModelSyncReport,
	ModelSyncVendorGroup,
} from '@/lib/model-sync-diff';
import { applyModelSync, fetchModelSyncReport } from './model-api';

export function modelSyncSelectionKey(modelId: string, fieldKey: string): string {
	return `${modelId}\u0000${fieldKey}`;
}

/** 以官方 default_apply 为初值，保留用户在重新加载前已做的选择。 */
function buildSelection(
	report: ModelSyncReport,
	previous: Record<string, boolean>
): Record<string, boolean> {
	const next: Record<string, boolean> = {};
	for (const group of report.groups) {
		for (const model of group.models) {
			for (const field of model.fields) {
				const key = modelSyncSelectionKey(model.model_id, field.key);
				next[key] = key in previous ? previous[key] : field.default_apply;
			}
		}
	}
	return next;
}

export function useModelSync(options: {
	onChanged: () => void | Promise<void>;
	/** 每次拿到最新差异报告（手动检查、面板内重新加载、同步后）都会回调。 */
	onReport: (report: ModelSyncReport) => void;
}) {
	const { onChanged, onReport } = options;
	const t = useTranslations('models.sync');
	const { notify, confirm } = useFeedback();

	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [report, setReport] = useState<ModelSyncReport | null>(null);
	const [activeVendor, setActiveVendor] = useState<string | null>(null);
	const [selection, setSelection] = useState<Record<string, boolean>>({});
	const [submitting, setSubmitting] = useState(false);
	const [checking, setChecking] = useState(false);
	const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

	const load = useCallback(
		async (resetSelection: boolean) => {
			setLoading(true);
			setError('');
			try {
				const next = await fetchModelSyncReport();
				setReport(next);
				onReport(next);
				setSelection((prev) => buildSelection(next, resetSelection ? {} : prev));
				setActiveVendor((current) =>
					current !== null && next.groups.some((g) => g.vendor === current)
						? current
						: (next.groups[0]?.vendor ?? null)
				);
			} catch (e) {
				setError(e instanceof Error ? e.message : t('loadFailed'));
			} finally {
				setLoading(false);
			}
		},
		[onReport, t]
	);

	/** 手动检查：拉取差异并告知结果；有更新时由页面提示条承接，不自动弹出面板。 */
	const check = useCallback(async () => {
		setChecking(true);
		try {
			const next = await fetchModelSyncReport();
			setReport(next);
			setSelection(buildSelection(next, {}));
			onReport(next);
			setLastCheckedAt(new Date());
			if (next.models_with_diff === 0) {
				notify('success', t('check.upToDate'));
			} else {
				notify(
					'info',
					t('check.foundUpdates', { models: next.models_with_diff, vendors: next.groups.length })
				);
			}
		} catch (e) {
			notify('error', e instanceof Error ? e.message : t('loadFailed'));
		} finally {
			setChecking(false);
		}
	}, [notify, onReport, t]);

	/** `initialVendor`：想先看的厂商；缺省或无差异时落到第一项。 */
	const openSync = useCallback(
		(initialVendor?: string) => {
			setOpen(true);
			setActiveVendor(initialVendor ?? null);
			void load(true);
		},
		[load]
	);

	const close = useCallback(() => {
		if (submitting) return;
		setOpen(false);
	}, [submitting]);

	const toggleField = useCallback((modelId: string, fieldKey: string) => {
		const key = modelSyncSelectionKey(modelId, fieldKey);
		setSelection((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	const setGroupFields = useCallback(
		(group: ModelSyncVendorGroup, value: boolean) => {
			setSelection((prev) => {
				const next = { ...prev };
				for (const model of group.models) {
					for (const field of model.fields) {
						next[modelSyncSelectionKey(model.model_id, field.key)] = value;
					}
				}
				return next;
			});
		},
		[]
	);

	/** 恢复为官方默认勾选（价格默认保留）。 */
	const resetToDefaults = useCallback(() => {
		if (!report) return;
		setSelection(buildSelection(report, {}));
	}, [report]);

	const selectedFieldsOf = useCallback(
		(model: ModelSyncModelEntry): ModelSyncField[] =>
			model.fields.filter((f) => selection[modelSyncSelectionKey(model.model_id, f.key)]),
		[selection]
	);

	const totals = useMemo(() => {
		let fields = 0;
		let models = 0;
		let activeRoutes = 0;
		let pricing = 0;
		for (const group of report?.groups ?? []) {
			for (const model of group.models) {
				const picked = model.fields.filter(
					(f) => selection[modelSyncSelectionKey(model.model_id, f.key)]
				);
				if (picked.length === 0) continue;
				fields += picked.length;
				models += 1;
				if (picked.some((f) => f.key === 'pricing_profile')) {
					pricing += 1;
					activeRoutes += model.active_routes_count;
				}
			}
		}
		return { fields, models, pricing, activeRoutes };
	}, [report, selection]);

	const runApply = useCallback(
		async (modelIds?: readonly string[]) => {
			if (!report) return;
			const only = modelIds ? new Set(modelIds) : null;
			const items: Array<{ model_id: string; fields: string[] }> = [];
			let pricingModels = 0;
			let activeRoutes = 0;
			for (const group of report.groups) {
				for (const model of group.models) {
					if (only && !only.has(model.model_id)) continue;
					const fields = model.fields
						.filter((f) => selection[modelSyncSelectionKey(model.model_id, f.key)])
						.map((f) => f.key);
					if (fields.length === 0) continue;
					items.push({ model_id: model.model_id, fields });
					if (fields.includes('pricing_profile')) {
						pricingModels += 1;
						activeRoutes += model.active_routes_count;
					}
				}
			}
			if (items.length === 0) {
				notify('error', t('selectNone'));
				return;
			}
			const fieldCount = items.reduce((sum, item) => sum + item.fields.length, 0);
			const ok = await confirm({
				title: t('confirmTitle'),
				message:
					t('confirmMessage', { models: items.length, fields: fieldCount }) +
					(pricingModels > 0
						? `\n${t('confirmPricing', { models: pricingModels, routes: activeRoutes })}`
						: ''),
				confirmLabel: t('confirmApply'),
			});
			if (!ok) return;

			setSubmitting(true);
			try {
				const result = await applyModelSync({ items });
				if (!result.success) {
					notify('error', result.message || t('applyFailed'));
					return;
				}
				const { updated, skipped, failed } = result.data;
				const detail =
					failed.length > 0 ? failed.map((f) => `${f.model_id}: ${f.message}`).join('\n') : undefined;
				notify(
					failed.length > 0 ? 'error' : 'success',
					failed.length > 0
						? t('appliedWithFail', { updated, failed: failed.length })
						: skipped > 0
							? t('appliedWithSkipped', { updated, skipped })
							: t('applied', { updated }),
					detail
				);
				await load(false);
				await onChanged();
			} catch (e) {
				console.error('Apply model sync error:', e);
				notify('error', t('applyFailed'));
			} finally {
				setSubmitting(false);
			}
		},
		[confirm, load, notify, onChanged, report, selection, t]
	);

	return {
		open,
		loading,
		error,
		report,
		activeVendor,
		setActiveVendor,
		checking,
		lastCheckedAt,
		check,
		selection,
		submitting,
		totals,
		openSync,
		close,
		reload: () => load(false),
		toggleField,
		setGroupFields,
		resetToDefaults,
		selectedFieldsOf,
		runApply,
	};
}

export type ModelSyncState = ReturnType<typeof useModelSync>;
