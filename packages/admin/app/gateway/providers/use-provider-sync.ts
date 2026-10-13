'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeedback } from '@/components/feedback';
import type {
	ProviderSyncField,
	ProviderSyncKindGroup,
	ProviderSyncProviderEntry,
	ProviderSyncReport,
} from '@/lib/provider-sync-diff';
import { applyProviderSync, fetchProviderSyncReport, migrateProviderKind } from './provider-api';

/** 左侧列表里「模板已变更」这一项的固定键，不会与任何 kind 冲突（kind 不含此前缀）。 */
export const PROVIDER_SYNC_ORPHANS_KEY = '__orphans__';

export function syncSelectionKey(providerId: string, fieldKey: string): string {
	return `${providerId}\u0000${fieldKey}`;
}

/** 以官方 default_apply 为初值，保留用户在重新加载前已做的选择。 */
function buildSelection(
	report: ProviderSyncReport,
	previous: Record<string, boolean>
): Record<string, boolean> {
	const next: Record<string, boolean> = {};
	for (const group of report.groups) {
		for (const provider of group.providers) {
			for (const field of provider.fields) {
				const key = syncSelectionKey(provider.provider_id, field.key);
				next[key] = key in previous ? previous[key] : field.default_apply;
			}
		}
	}
	return next;
}

function firstActiveKey(report: ProviderSyncReport): string | null {
	if (report.groups.length > 0) return report.groups[0].kind;
	if (report.orphans.length > 0) return PROVIDER_SYNC_ORPHANS_KEY;
	return null;
}

export function useProviderSync(options: {
	onChanged: () => void | Promise<void>;
	/** 每次拿到最新差异报告（手动检查、面板内重新加载、同步后）都会回调。 */
	onReport: (report: ProviderSyncReport) => void;
}) {
	const { onChanged, onReport } = options;
	const t = useTranslations('providers.sync');
	const { notify, confirm } = useFeedback();

	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [report, setReport] = useState<ProviderSyncReport | null>(null);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const [selection, setSelection] = useState<Record<string, boolean>>({});
	const [submitting, setSubmitting] = useState(false);
	const [orphanChoice, setOrphanChoice] = useState<Record<string, string>>({});
	const [orphanBusyId, setOrphanBusyId] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

	const load = useCallback(async (resetSelection: boolean) => {
		setLoading(true);
		setError('');
		try {
			const next = await fetchProviderSyncReport();
			setReport(next);
			onReport(next);
			setSelection((prev) => buildSelection(next, resetSelection ? {} : prev));
			setActiveKey((current) => {
				const stillValid =
					current !== null &&
					(current === PROVIDER_SYNC_ORPHANS_KEY
						? next.orphans.length > 0
						: next.groups.some((g) => g.kind === current));
				return stillValid ? current : firstActiveKey(next);
			});
			setOrphanChoice((prev) => {
				const merged: Record<string, string> = {};
				for (const orphan of next.orphans) {
					merged[orphan.provider_id] = prev[orphan.provider_id] ?? orphan.suggested_kind ?? '';
				}
				return merged;
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : t('loadFailed'));
		} finally {
			setLoading(false);
		}
	}, [onReport, t]);

	/** 手动检查：拉取差异并告知结果；有更新时由页面提示条承接，不自动弹出面板。 */
	const check = useCallback(async () => {
		setChecking(true);
		try {
			const next = await fetchProviderSyncReport();
			setReport(next);
			setSelection(buildSelection(next, {}));
			onReport(next);
			setLastCheckedAt(new Date());
			const updates = next.providers_with_diff;
			const orphans = next.orphans.length;
			if (updates === 0 && orphans === 0) {
				notify('success', t('check.upToDate'));
			} else {
				notify(
					'info',
					updates > 0
						? t('check.foundUpdates', { providers: updates, kinds: next.groups.length })
						: t('check.foundOrphans', { count: orphans })
				);
			}
		} catch (e) {
			notify('error', e instanceof Error ? e.message : t('loadFailed'));
		} finally {
			setChecking(false);
		}
	}, [notify, onReport, t]);

	/** `initialKey`：想先看的类型（kind 或 `PROVIDER_SYNC_ORPHANS_KEY`）；缺省或无差异时落到第一项。 */
	const openSync = useCallback((initialKey?: string) => {
		setOpen(true);
		setActiveKey(initialKey ?? null);
		void load(true);
	}, [load]);

	const close = useCallback(() => {
		if (submitting) return;
		setOpen(false);
	}, [submitting]);

	const toggleField = useCallback((providerId: string, fieldKey: string) => {
		const key = syncSelectionKey(providerId, fieldKey);
		setSelection((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	const setProviderFields = useCallback(
		(provider: ProviderSyncProviderEntry, value: boolean) => {
			setSelection((prev) => {
				const next = { ...prev };
				for (const field of provider.fields) {
					next[syncSelectionKey(provider.provider_id, field.key)] = value;
				}
				return next;
			});
		},
		[]
	);

	const setGroupFields = useCallback((group: ProviderSyncKindGroup, value: boolean) => {
		setSelection((prev) => {
			const next = { ...prev };
			for (const provider of group.providers) {
				for (const field of provider.fields) {
					next[syncSelectionKey(provider.provider_id, field.key)] = value;
				}
			}
			return next;
		});
	}, []);

	/** 恢复为官方默认勾选（新增 / 变更采用官方，本地独有保留）。 */
	const resetToDefaults = useCallback(() => {
		if (!report) return;
		setSelection(buildSelection(report, {}));
	}, [report]);

	const selectedFieldsOf = useCallback(
		(provider: ProviderSyncProviderEntry): ProviderSyncField[] =>
			provider.fields.filter((f) => selection[syncSelectionKey(provider.provider_id, f.key)]),
		[selection]
	);

	const totals = useMemo(() => {
		let fields = 0;
		let providers = 0;
		let activeRoutes = 0;
		for (const group of report?.groups ?? []) {
			for (const provider of group.providers) {
				const count = provider.fields.filter(
					(f) => selection[syncSelectionKey(provider.provider_id, f.key)]
				).length;
				if (count === 0) continue;
				fields += count;
				providers += 1;
				activeRoutes += provider.active_routes_count;
			}
		}
		return { fields, providers, activeRoutes };
	}, [report, selection]);

	const runApply = useCallback(
		async (providerIds?: readonly string[]) => {
			if (!report) return;
			const only = providerIds ? new Set(providerIds) : null;
			const items: Array<{ provider_id: string; fields: string[] }> = [];
			let activeRoutes = 0;
			for (const group of report.groups) {
				for (const provider of group.providers) {
					if (only && !only.has(provider.provider_id)) continue;
					const fields = provider.fields
						.filter((f) => selection[syncSelectionKey(provider.provider_id, f.key)])
						.map((f) => f.key);
					if (fields.length === 0) continue;
					items.push({ provider_id: provider.provider_id, fields });
					activeRoutes += provider.active_routes_count;
				}
			}
			if (items.length === 0) {
				notify('error', t('selectNone'));
				return;
			}
			const fieldCount = items.reduce((sum, item) => sum + item.fields.length, 0);
			const ok = await confirm({
				title: t('confirmTitle'),
				message: t('confirmMessage', {
					providers: items.length,
					fields: fieldCount,
					routes: activeRoutes,
				}),
				confirmLabel: t('confirmApply'),
			});
			if (!ok) return;

			setSubmitting(true);
			try {
				const result = await applyProviderSync({ items });
				if (!result.success) {
					notify('error', result.message || t('applyFailed'));
					return;
				}
				const { updated, skipped, failed } = result.data;
				const detail =
					failed.length > 0 ? failed.map((f) => `${f.provider_id}: ${f.message}`).join('\n') : undefined;
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
				console.error('Apply provider sync error:', e);
				notify('error', t('applyFailed'));
			} finally {
				setSubmitting(false);
			}
		},
		[confirm, load, notify, onChanged, report, selection, t]
	);

	const setOrphanTarget = useCallback((providerId: string, kind: string) => {
		setOrphanChoice((prev) => ({ ...prev, [providerId]: kind }));
	}, []);

	const migrateOrphan = useCallback(
		async (providerId: string) => {
			const kind = orphanChoice[providerId];
			if (!kind) {
				notify('error', t('orphans.pickTarget'));
				return;
			}
			setOrphanBusyId(providerId);
			try {
				const result = await migrateProviderKind(providerId, kind);
				if (!result.success) {
					notify('error', result.message || t('applyFailed'));
					return;
				}
				notify('success', t('orphans.migrated'));
				await load(false);
				await onChanged();
			} catch (e) {
				console.error('Migrate provider kind error:', e);
				notify('error', t('applyFailed'));
			} finally {
				setOrphanBusyId(null);
			}
		},
		[load, notify, onChanged, orphanChoice, t]
	);

	return {
		open,
		loading,
		error,
		report,
		activeKey,
		setActiveKey,
		checking,
		lastCheckedAt,
		check,
		selection,
		submitting,
		totals,
		orphanChoice,
		orphanBusyId,
		openSync,
		close,
		reload: () => load(false),
		toggleField,
		setProviderFields,
		setGroupFields,
		resetToDefaults,
		selectedFieldsOf,
		runApply,
		setOrphanTarget,
		migrateOrphan,
	};
}

export type ProviderSyncState = ReturnType<typeof useProviderSync>;
