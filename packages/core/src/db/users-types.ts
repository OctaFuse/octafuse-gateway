/** 共享类型：`UsersRepository` 与多引擎实现共用。 */
export type UserMaxBudgetFilter = 'positive' | 'zero_or_negative' | 'null';

export interface InsertUserParams {
	id: string;
	email?: string | null;
	budgetMax?: number | null;
	budgetBase?: number | null;
	budgetSpent?: number | null;
	budgetPeriod?: string;
	budgetResetAt?: string | null;
	status?: string;
	metadata?: string | null;
	externalSystem?: string | null;
	externalUserId?: string | null;
}
