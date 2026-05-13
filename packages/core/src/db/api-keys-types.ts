/** 共享类型：仓储接口与 D1/PG 实现共用，避免循环依赖。 */
export type BudgetFilter = 'positive' | 'zero_or_negative' | 'null';

export interface InsertKeyParams {
	id: string;
	key: string;
	userId: string;
	userEmail: string | null;
	budgetMax: number | null;
	/**
	 * 写入 `budget_base` 列的初始值：周期 reset 时 `budget_max` 的恢复基准。
	 * 调用方可省略，仓储实现按 0 写入，保持与历史行为兼容。
	 */
	budgetBase?: number | null;
	budgetSpent: number;
	budgetPeriod: string;
	budgetResetAt: string | null;
	status: string;
}
