/**
 * 永久额度加额：审计行构造与返回值。
 */
import { roundGatewayMoney } from '../lib/money-precision';
import {
	changedFieldsToJson,
	computeChangedFields,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
} from './user-audit-snapshot';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';
import type { UserRow } from '../types';
import type { WalletCreditKind } from '../services/wallet-balance';
import { computeWalletBalance } from '../services/wallet-balance';

export class WalletCreditUserNotFoundError extends Error {
	readonly userId: string;
	constructor(userId: string) {
		super(`User not found: ${userId}`);
		this.name = 'WalletCreditUserNotFoundError';
		this.userId = userId;
	}
}

/** drizzle / 裸行 → UserRow，供加额前读快照。 */
export function mapStorageUserToRow(r: {
	id: string;
	email: string | null;
	budgetMax: number | string | null;
	budgetBase: number | string | null;
	budgetSpent: number | string | null;
	budgetPeriod: string;
	budgetResetAt: string | null;
	walletGranted: number | string | null;
	walletSpent: number | string | null;
	status: string;
	metadata: string | null;
	chargedCostFactors?: string | null;
	externalSystem: string | null;
	externalUserId: string | null;
	createdAt: string;
	updatedAt: string;
}): UserRow {
	return {
		id: r.id,
		email: r.email ?? '',
		budget_max: r.budgetMax == null ? null : roundGatewayMoney(Number(r.budgetMax)),
		budget_base: roundGatewayMoney(Number(r.budgetBase ?? 0)),
		budget_spent: roundGatewayMoney(Number(r.budgetSpent ?? 0)),
		budget_period: r.budgetPeriod,
		budget_reset_at: r.budgetResetAt,
		wallet_granted: roundGatewayMoney(Number(r.walletGranted ?? 0)),
		wallet_spent: roundGatewayMoney(Number(r.walletSpent ?? 0)),
		status: r.status,
		metadata: r.metadata,
		charged_cost_factors: r.chargedCostFactors ?? null,
		external_system: r.externalSystem,
		external_user_id: r.externalUserId,
		created_at: r.createdAt,
		updated_at: r.updatedAt,
	};
}

export type GrantWalletCreditParams = {
	userId: string;
	amount: number;
	kind: WalletCreditKind;
	externalRef: string;
	reason?: string | null;
	actorType?: 'admin' | 'service' | 'system';
	actorId?: string | null;
	source?: string | null;
};

export type GrantWalletCreditResult = {
	status: 'applied' | 'duplicate';
	walletGranted: number;
	walletSpent: number;
	walletBalance: number;
};

export function buildWalletCreditAuditRow(
	row: UserRow,
	params: GrantWalletCreditParams,
	auditId: string
): { audit: InsertUserAuditLogParams; afterGranted: number } {
	const amount = roundGatewayMoney(params.amount);
	const afterGranted = roundGatewayMoney(Number(row.wallet_granted ?? 0) + amount);
	const before = userRowToSnapshot(row);
	const after = snapshotWithOverrides(before, { wallet_granted: afterGranted });
	return {
		afterGranted,
		audit: {
			id: auditId,
			userId: params.userId,
			eventType: 'wallet_credit',
			actorType: params.actorType ?? 'admin',
			actorId: params.actorId ?? null,
			source: params.source ?? 'admin_wallet',
			reasonCode: `wallet_credit_${params.kind}`,
			reasonText: params.reason?.trim() || `Wallet credit (${params.kind})`,
			changePayload: JSON.stringify({
				amount,
				kind: params.kind,
				external_ref: params.externalRef,
			}),
			beforeUserSnapshot: snapshotToJson(before),
			afterUserSnapshot: snapshotToJson(after),
			changedFields: changedFieldsToJson(computeChangedFields(before, after)),
			correlationId: auditId,
			dedupKey: params.externalRef,
		},
	};
}

export function walletCreditResult(
	status: 'applied' | 'duplicate',
	walletGranted: number,
	walletSpent: number
): GrantWalletCreditResult {
	return {
		status,
		walletGranted: roundGatewayMoney(walletGranted),
		walletSpent: roundGatewayMoney(walletSpent),
		walletBalance: computeWalletBalance(walletGranted, walletSpent),
	};
}
