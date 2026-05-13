/**
 * D1 仓储补充接口（预处理语句构造器），仅 D1 实现满足；与 `gateway-repository-interfaces` 中的领域接口分离。
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { InsertRequestLogParams } from '../request-logs-types';
import type { InsertKeyParams } from '../api-keys-types';

export interface ApiKeysD1Statements {
	buildInsertApiKeyStatement(db: D1Database, params: InsertKeyParams): D1PreparedStatement;
	buildIncrementApiKeyBudgetSpentStatement(db: D1Database, id: string, amount: number): D1PreparedStatement;
}

export interface RequestLogsD1Statements {
	buildInsertRequestLogStatement(db: D1Database, params: InsertRequestLogParams): D1PreparedStatement;
}
