/**
 * 将 `user_audit_logs` 的 before/after 用户快照 JSON 与 `changed_fields` 转为可读 diff 行（Admin UI）。
 */

function fmtVal(v: unknown): string {
	if (v == null) return '—';
	if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		const s = JSON.stringify(v);
		return s.length > 120 ? `${s.slice(0, 120)}…` : s;
	} catch {
		return String(v);
	}
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	const t = raw?.trim();
	if (!t) return null;
	try {
		const o = JSON.parse(t) as unknown;
		if (o && typeof o === 'object' && !Array.isArray(o)) {
			return o as Record<string, unknown>;
		}
	} catch {
		/* ignore */
	}
	return null;
}

const WALLET_MONEY_DECIMAL_PLACES = 6;

function moneyNumber(value: unknown): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function moneyEqual(a: number, b: number): boolean {
	return a.toFixed(WALLET_MONEY_DECIMAL_PLACES) === b.toFixed(WALLET_MONEY_DECIMAL_PLACES);
}

/** 已在「永久额度 / Wallet」列展示的快照字段，不在用户变更摘要中重复。 */
export const WALLET_AUDIT_SNAPSHOT_FIELDS = ['wallet_granted', 'wallet_spent'] as const;

export type AuditWalletSnapshotDiff = {
	hasSnapshot: boolean;
	beforeGranted: number;
	afterGranted: number;
	beforeSpent: number;
	afterSpent: number;
	beforeRemaining: number;
	afterRemaining: number;
	grantedChanged: boolean;
	spentChanged: boolean;
	remainingChanged: boolean;
};

/**
 * 从 before/after 用户快照解析永久额度前后值。无快照时 `hasSnapshot` 为 false。
 * 余额为 granted − spent，不落库。
 */
export function summarizeWalletSnapshotDiff(
	beforeUserSnapshot?: string | null,
	afterUserSnapshot?: string | null
): AuditWalletSnapshotDiff {
	const before = parseJsonObject(beforeUserSnapshot ?? null);
	const after = parseJsonObject(afterUserSnapshot ?? null);
	const hasSnapshot = before != null || after != null;
	const beforeGranted = moneyNumber(before?.wallet_granted);
	const afterGranted = moneyNumber(after?.wallet_granted);
	const beforeSpent = moneyNumber(before?.wallet_spent);
	const afterSpent = moneyNumber(after?.wallet_spent);
	const beforeRemaining = beforeGranted - beforeSpent;
	const afterRemaining = afterGranted - afterSpent;
	return {
		hasSnapshot,
		beforeGranted,
		afterGranted,
		beforeSpent,
		afterSpent,
		beforeRemaining,
		afterRemaining,
		grantedChanged: hasSnapshot && !moneyEqual(beforeGranted, afterGranted),
		spentChanged: hasSnapshot && !moneyEqual(beforeSpent, afterSpent),
		remainingChanged: hasSnapshot && !moneyEqual(beforeRemaining, afterRemaining),
	};
}

function parseChangedFields(raw: string | null | undefined): string[] | null {
	const t = raw?.trim();
	if (!t) return null;
	try {
		const a = JSON.parse(t) as unknown;
		if (!Array.isArray(a)) return null;
		return a.filter((x): x is string => typeof x === 'string' && x.length > 0);
	} catch {
		return null;
	}
}

/**
 * 返回若干行 `field: before → after`；无快照时返回空数组。
 * @param omitSnapshotFields 不在摘要中展示的字段（例如表格其它列已展示预算项）
 */
export function summarizeUserSnapshotDiffLines(options: {
	before_user_snapshot?: string | null;
	after_user_snapshot?: string | null;
	changed_fields?: string | null;
	omitSnapshotFields?: readonly string[];
}): string[] {
	const before = parseJsonObject(options.before_user_snapshot ?? null);
	const after = parseJsonObject(options.after_user_snapshot ?? null);
	if (!before && !after) return [];

	const omit = new Set(options.omitSnapshotFields ?? []);

	const fields = parseChangedFields(options.changed_fields ?? null);
	const keys =
		fields && fields.length > 0
			? fields
			: Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])).filter((k) => k !== 'id');

	const lines: string[] = [];
	for (const k of keys) {
		if (omit.has(k)) continue;
		const bv = before?.[k];
		const av = after?.[k];
		if (fmtVal(bv) === fmtVal(av) && fields == null) continue;
		lines.push(`${k}: ${fmtVal(bv)} → ${fmtVal(av)}`);
	}
	return lines;
}
