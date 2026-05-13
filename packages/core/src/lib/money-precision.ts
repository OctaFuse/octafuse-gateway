/**
 * Gateway 持久化金额（`api_keys` 预算列、`api_key_request_logs` 成本列、审计日志等）的小数位约定。
 */
export const GATEWAY_MONEY_DECIMAL_PLACES = 6;

const SCALE = 10 ** GATEWAY_MONEY_DECIMAL_PLACES;

/**
 * 写入 D1 REAL 列前对美元类金额舍入，减少浮点长尾与展示杂乱。
 */
export function roundGatewayMoney(value: number): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return 0;
	}
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.round(value * SCALE) / SCALE;
}

/**
 * 生成聚合查询中的 `ROUND(<expr>, p)` 片段，使 SUM 等读出形状统一。
 */
export function sqlMoneyRound(expr: string): string {
	return `ROUND(${expr}, ${GATEWAY_MONEY_DECIMAL_PLACES})`;
}
