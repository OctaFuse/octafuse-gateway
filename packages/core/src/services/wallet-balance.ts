/**
 * 周期额度（Budget）与永久额度（Wallet）的纯函数：余额、跨池拆分、老数据回填。
 */
import { roundGatewayMoney } from '../lib/money-precision';

export const WALLET_CREDIT_KINDS = ['topup', 'signup_bonus', 'admin_adjust', 'refund'] as const;
export type WalletCreditKind = (typeof WALLET_CREDIT_KINDS)[number];

export function isWalletCreditKind(value: string): value is WalletCreditKind {
	return (WALLET_CREDIT_KINDS as readonly string[]).includes(value);
}

/** `wallet_balance = wallet_granted − wallet_spent`（派生，不落列）。 */
export function computeWalletBalance(walletGranted: number, walletSpent: number): number {
	return roundGatewayMoney(walletGranted) - roundGatewayMoney(walletSpent);
}

/**
 * 周期剩余。`budget_max == null` 表示无限，返回 `null`。
 * 超支时为负数（迁移后 spent 会被钳到 max，新扣费不再让 spent 超过 max）。
 */
export function computePeriodRemaining(budgetMax: number | null, budgetSpent: number): number | null {
	if (budgetMax == null) return null;
	return roundGatewayMoney(budgetMax) - roundGatewayMoney(budgetSpent);
}

/**
 * 总剩余。`budget_max == null` 为无限（返回 `null`）。
 * 公式：`(budget_max − budget_spent) + wallet_balance`。
 */
export function computeTotalRemaining(
	budgetMax: number | null,
	budgetSpent: number,
	walletGranted: number,
	walletSpent: number
): number | null {
	if (budgetMax == null) return null;
	return roundGatewayMoney(
		computePeriodRemaining(budgetMax, budgetSpent)! + computeWalletBalance(walletGranted, walletSpent)
	);
}

/** 可用额度判定：无限或总剩余 > 0。 */
export function hasPositiveTotalBalance(
	budgetMax: number | null,
	budgetSpent: number,
	walletGranted: number,
	walletSpent: number
): boolean {
	const total = computeTotalRemaining(budgetMax, budgetSpent, walletGranted, walletSpent);
	return total == null || total > 0;
}

/** 是否付得起 `cost`：无限或总剩余 ≥ cost。 */
export function canAffordTotalCost(
	budgetMax: number | null,
	budgetSpent: number,
	walletGranted: number,
	walletSpent: number,
	cost: number
): boolean {
	const total = computeTotalRemaining(budgetMax, budgetSpent, walletGranted, walletSpent);
	if (total == null) return true;
	return total >= roundGatewayMoney(cost);
}

/**
 * 先周期、后永久。`periodRemaining == null` 表示周期无限，整笔走周期。
 * 周期不够时 spent 只加到剩余，差额进永久池。
 */
export function splitChargeAcrossPools(
	cost: number,
	periodRemaining: number | null
): { fromBudget: number; fromWallet: number } {
	const charged = roundGatewayMoney(cost);
	if (charged <= 0) {
		return { fromBudget: 0, fromWallet: 0 };
	}
	if (periodRemaining == null) {
		return { fromBudget: charged, fromWallet: 0 };
	}
	const remaining = Math.max(0, roundGatewayMoney(periodRemaining));
	if (charged <= remaining) {
		return { fromBudget: charged, fromWallet: 0 };
	}
	return {
		fromBudget: remaining,
		fromWallet: roundGatewayMoney(charged - remaining),
	};
}

/** 从预算快照拆池；无快照时整笔走周期（与旧路径一致）。 */
export function splitChargeFromBudgetSnapshot(
	snapshot: { budgetMax: number | null; budgetSpent: number } | null,
	chargedCost: number
): { fromBudget: number; fromWallet: number; afterPeriodSpent: number } {
	const beforeSpent = snapshot?.budgetSpent ?? 0;
	const periodRemaining = snapshot ? computePeriodRemaining(snapshot.budgetMax, snapshot.budgetSpent) : null;
	const split = splitChargeAcrossPools(chargedCost, periodRemaining);
	return {
		...split,
		afterPeriodSpent: roundGatewayMoney(beforeSpent + split.fromBudget),
	};
}

export type LegacyWalletBackfillInput = {
	budget_max: number | null;
	budget_base: number;
	budget_spent: number;
	budget_period?: string;
};

export type LegacyWalletBackfillResult = {
	wallet_granted: number;
	wallet_spent: number;
	budget_max: number | null;
	budget_spent: number;
	skipped: boolean;
};

/**
 * 0027 回填公式。`budget_max IS NULL` 跳过。
 * `max=0 AND period=none` 视为到期清零，不把 max 抬回 base。
 */
export function applyLegacyWalletBackfill(input: LegacyWalletBackfillInput): LegacyWalletBackfillResult {
	if (input.budget_max == null) {
		return {
			wallet_granted: 0,
			wallet_spent: 0,
			budget_max: null,
			budget_spent: roundGatewayMoney(input.budget_spent),
			skipped: true,
		};
	}
	const budgetMax = roundGatewayMoney(input.budget_max);
	const budgetBase = roundGatewayMoney(input.budget_base);
	const budgetSpent = roundGatewayMoney(input.budget_spent);
	if (budgetMax === 0 && (input.budget_period ?? 'none') === 'none') {
		return {
			wallet_granted: 0,
			wallet_spent: 0,
			budget_max: 0,
			budget_spent: budgetSpent,
			skipped: false,
		};
	}
	return {
		wallet_granted: roundGatewayMoney(Math.max(0, budgetMax - Math.max(budgetSpent, budgetBase))),
		wallet_spent: 0,
		budget_max: budgetBase,
		budget_spent: roundGatewayMoney(Math.min(budgetSpent, budgetBase)),
		skipped: false,
	};
}
