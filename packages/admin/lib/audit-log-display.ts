/**
 * 审计日志表格共用展示：枚举文案、快照 diff、额度前后值比较。
 */
import type { useTranslations } from 'next-intl';
import { formatGatewayDateTime } from '@/lib/datetime';
import { formatGatewayMoneyCode, formatGatewayMoneyCodeSigned } from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { WALLET_AUDIT_SNAPSHOT_FIELDS } from '@/lib/audit-user-snapshot-diff';
import { USER_AUDIT_ACTOR_KINDS, type GatewayApiKeyBudgetAuditLog } from '@/lib/types';

/** 已在 Budget / Period plan / Wallet 列展示的快照字段，不在「User change detail」重复 */
export const OMIT_AUDIT_LOG_SNAPSHOT_FIELDS = [
	'budget_spent',
	'budget_max',
	'budget_base',
	'budget_period',
	'budget_reset_at',
	...WALLET_AUDIT_SNAPSHOT_FIELDS,
] as const;

const AUDIT_LOG_ACTOR_KIND_SET = new Set<string>(USER_AUDIT_ACTOR_KINDS);

export type AuditEnumGroup = 'eventTypes' | 'sourceChannels' | 'actorTypes' | 'actorKinds';

export function auditEnumLabel(
	t: ReturnType<typeof useTranslations>,
	group: AuditEnumGroup,
	value: string | null | undefined
): string {
	if (value == null || value === '') return '—';
	const key = `${group}.${value}`;
	return t.has(key) ? t(key) : value;
}

/** `actor_id` 形如 `<kind>:<identifier>`；未知或缺失前缀时 kind 为 null，整串按标识符展示。 */
export function parseAuditActorId(actorId: string | null | undefined): { kind: string | null; identifier: string } {
	if (!actorId) return { kind: null, identifier: '' };
	const separator = actorId.indexOf(':');
	if (separator === -1) return { kind: null, identifier: actorId };
	const kind = actorId.slice(0, separator);
	if (!AUDIT_LOG_ACTOR_KIND_SET.has(kind)) return { kind: null, identifier: actorId };
	return { kind, identifier: actorId.slice(separator + 1) };
}

/** change_payload 展开行：去掉已由 Budget / Period plan / Time / Event 列展示的键 */
function shouldOmitChangePayloadDisplayLine(line: string): boolean {
	const colon = line.indexOf(':');
	const key = (colon === -1 ? line : line.slice(0, colon)).trim();
	if (!key) return false;
	if (key.startsWith('before_budget_') || key.startsWith('after_budget_')) return true;
	if (['actor_id', 'reason_code', 'reason_text', 'source', 'correlation_id'].includes(key)) return true;
	return false;
}

export function formatSignedMoney(value: number, currency: string): string {
	return formatGatewayMoneyCodeSigned(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

export function formatBudgetMax(value: number | null, currency: string, noLimitLabel = 'no limit'): string {
	if (value == null) return noLimitLabel;
	return formatGatewayMoneyCode(value, currency, GATEWAY_MONEY_DECIMAL_PLACES);
}

export function formatAuditTime(iso: string | null | undefined, timeZone: string): string {
	if (iso == null || iso === '') return '—';
	return formatGatewayDateTime(iso, timeZone);
}

export function shortAuditId(id: string | null | undefined): string {
	if (id == null || id === '') return '—';
	if (id.length < 14) return id;
	return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

/** Reason 行：code / text 并存且不同时压缩为一行「code · text」，否则单行。 */
export function auditReasonOneLine(
	reasonCode: string | null | undefined,
	reasonText: string | null | undefined
): {
	line: string;
	isMono: boolean;
	title: string;
} {
	const rc = (reasonCode ?? '').trim();
	const rt = (reasonText ?? '').trim();
	if (!rc && !rt) return { line: '—', isMono: true, title: '' };
	if (rc && rt && rc !== rt) {
		const line = `${rc} · ${rt}`;
		return { line, isMono: false, title: line };
	}
	const single = rt || rc;
	return { line: single, isMono: !!rc && !rt, title: single };
}

/** 从 `change_payload` 解析的扩展字段（与 `@octafuse/core` `mergeUserAuditChangePayload` 写入结构对齐） */
export function auditDisplayExtras(item: GatewayApiKeyBudgetAuditLog) {
	let m: Record<string, unknown> = {};
	try {
		const raw = item.change_payload;
		if (raw) m = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		/* keep empty */
	}
	const str = (v: unknown) => (typeof v === 'string' ? v : null);
	return {
		reason_text: item.reason_text ?? str(m.reason_text),
		reason_code: item.reason_code ?? str(m.reason_code),
		actor_id: item.actor_id ?? str(m.actor_id),
		source: item.source ?? str(m.source),
		correlation_id: item.correlation_id ?? str(m.correlation_id),
		before_budget_period: item.before_budget_period ?? str(m.before_budget_period),
		after_budget_period: item.after_budget_period ?? str(m.after_budget_period),
		before_budget_reset_at: item.before_budget_reset_at ?? str(m.before_budget_reset_at),
		after_budget_reset_at: item.after_budget_reset_at ?? str(m.after_budget_reset_at),
	};
}

function isAuditObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** 与网关金额精度一致，用于判断 budget_max / budget_base 是否变化 */
export function budgetMoneySemanticallyEqual(
	before: number | null | undefined,
	after: number | null | undefined
): boolean {
	if (before == null && after == null) return true;
	if (before == null || after == null) return false;
	return before.toFixed(GATEWAY_MONEY_DECIMAL_PLACES) === after.toFixed(GATEWAY_MONEY_DECIMAL_PLACES);
}

export function budgetResetAtSemanticallyEqual(
	before: string | null | undefined,
	after: string | null | undefined
): boolean {
	if ((before == null || before === '') && (after == null || after === '')) return true;
	if (!before || !after) return false;
	const tb = new Date(before).getTime();
	const ta = new Date(after).getTime();
	if (Number.isNaN(tb) || Number.isNaN(ta)) return before === after;
	return tb === ta;
}

export type AuditDiffRow = {
	group: 'snapshot' | 'payload';
	field: string;
	before: string;
	after: string;
};

function parseAuditJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (isAuditObject(parsed)) return parsed;
	} catch {
		/* keep null */
	}
	return null;
}

function parseAuditChangedFields(raw: string | null | undefined): string[] | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!Array.isArray(parsed)) return null;
		return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
	} catch {
		return null;
	}
}

function formatAuditDiffValue(value: unknown): string {
	if (value == null || value === '') return '—';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function pushAuditDiffRow(
	rows: AuditDiffRow[],
	group: AuditDiffRow['group'],
	field: string,
	before: unknown,
	after: unknown
) {
	const beforeText = formatAuditDiffValue(before);
	const afterText = formatAuditDiffValue(after);
	if (beforeText === afterText) return;
	rows.push({ group, field, before: beforeText, after: afterText });
}

function pushNestedAuditDiffRows(
	rows: AuditDiffRow[],
	group: AuditDiffRow['group'],
	field: string,
	before: unknown,
	after: unknown,
	depth = 0
) {
	if ((isAuditObject(before) || isAuditObject(after)) && depth < 4) {
		const beforeObject = isAuditObject(before) ? before : {};
		const afterObject = isAuditObject(after) ? after : {};
		const keys = Array.from(new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]));
		keys.forEach((key) => {
			pushNestedAuditDiffRows(rows, group, `${field}.${key}`, beforeObject[key], afterObject[key], depth + 1);
		});
		return;
	}
	pushAuditDiffRow(rows, group, field, before, after);
}

function appendSnapshotDiffRows(rows: AuditDiffRow[], item: GatewayApiKeyBudgetAuditLog) {
	const before = parseAuditJsonObject(item.before_user_snapshot ?? null);
	const after = parseAuditJsonObject(item.after_user_snapshot ?? null);
	if (!before && !after) return;

	const fields = parseAuditChangedFields(item.changed_fields ?? null);
	const keys =
		fields && fields.length > 0
			? fields
			: Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).filter((key) => key !== 'id');
	const omitted = new Set<string>(OMIT_AUDIT_LOG_SNAPSHOT_FIELDS);
	keys.forEach((key) => {
		if (omitted.has(key)) return;
		pushNestedAuditDiffRows(rows, 'snapshot', key, before?.[key], after?.[key]);
	});
}

function appendPayloadDiffRows(rows: AuditDiffRow[], raw: string | null | undefined) {
	const payload = parseAuditJsonObject(raw);
	if (!payload) return;

	const handled = new Set<string>();
	const status = payload.status;
	if (isAuditObject(status) && ('from' in status || 'to' in status)) {
		pushAuditDiffRow(rows, 'payload', 'status', status.from, status.to);
		handled.add('status');
	}

	const metadata = payload.metadata;
	if (isAuditObject(metadata)) {
		handled.add('metadata');
		const changes = metadata.changes;
		if (isAuditObject(changes)) {
			Object.entries(changes).forEach(([key, value]) => {
				if (isAuditObject(value) && ('from' in value || 'to' in value)) {
					pushAuditDiffRow(rows, 'payload', `metadata.${key}`, value.from, value.to);
				} else {
					pushAuditDiffRow(rows, 'payload', `metadata.${key}`, '—', value);
				}
			});
		} else if ('from' in metadata || 'to' in metadata) {
			pushAuditDiffRow(rows, 'payload', 'metadata', metadata.from, metadata.to);
			pushNestedAuditDiffRows(rows, 'payload', 'metadata', metadata.from, metadata.to);
		} else {
			Object.entries(metadata).forEach(([key, value]) => {
				if (key === 'operation') return;
				pushAuditDiffRow(rows, 'payload', `metadata.${key}`, '—', value);
			});
		}
	}

	Object.entries(payload).forEach(([key, value]) => {
		if (handled.has(key)) return;
		if (key.startsWith('before_') || key.startsWith('after_')) return;
		if (key === 'metadata_patch_keys' || shouldOmitChangePayloadDisplayLine(`${key}:`)) return;
		if (isAuditObject(value) && ('from' in value || 'to' in value)) {
			pushAuditDiffRow(rows, 'payload', key, value.from, value.to);
		}
	});

	Object.keys(payload)
		.filter((key) => key.startsWith('before_'))
		.forEach((beforeKey) => {
			const suffix = beforeKey.slice('before_'.length);
			const afterKey = `after_${suffix}`;
			if (!(afterKey in payload)) return;
			if (shouldOmitChangePayloadDisplayLine(beforeKey) || shouldOmitChangePayloadDisplayLine(afterKey)) return;
			pushAuditDiffRow(rows, 'payload', suffix, payload[beforeKey], payload[afterKey]);
		});
}

export function auditDiffRows(item: GatewayApiKeyBudgetAuditLog): AuditDiffRow[] {
	const rows: AuditDiffRow[] = [];
	appendSnapshotDiffRows(rows, item);
	appendPayloadDiffRows(rows, item.change_payload);
	const seen = new Set<string>();
	return rows.filter((row) => {
		const key = `${row.field}:${row.before}:${row.after}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isSerializedAuditObject(value: string): boolean {
	return isAuditObject(parseAuditJsonObject(value));
}

export function auditSummaryDiffRows(rows: AuditDiffRow[]): AuditDiffRow[] {
	return rows.filter((row) => {
		if (row.field === 'metadata') return false;
		if (isSerializedAuditObject(row.before) || isSerializedAuditObject(row.after)) return false;
		return true;
	});
}
