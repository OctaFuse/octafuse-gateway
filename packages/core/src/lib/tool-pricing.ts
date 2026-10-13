/**
 * Agent Tools 三账本单价（metered / standard / charged）。
 * Catalog 存绝对单价；旧键 `cost` 为 charged 别名（仅有 cost 时三列相等）。
 */

import { roundGatewayMoney } from './money-precision';

/** Catalog / resolve 共用的三单价（单位随 BILLING_CURRENCY）。 */
export type ToolUnitPrices = {
	/** 供应成本单价 */
	metered: number;
	/** 目录标准单价 */
	standard: number;
	/** 用户扣费单价 */
	charged: number;
};

/** 写入 catalog JSON 时附带 legacy `cost`（= charged）。 */
export type ToolPricingFields = ToolUnitPrices & {
	/** @deprecated 兼容别名；等于 charged */
	cost: number;
};

/**
 * 解析单个金额字段；非法 → `null`（strict）或调用方决定默认。
 */
export function parseToolMoneyField(raw: unknown): number | null {
	if (raw === undefined || raw === null || raw === '') {
		return null;
	}
	if (typeof raw === 'number') {
		if (!Number.isFinite(raw) || raw < 0) {
			return null;
		}
		return roundGatewayMoney(raw);
	}
	if (typeof raw === 'string') {
		const t = raw.trim();
		if (!t) {
			return null;
		}
		const n = Number(t);
		if (!Number.isFinite(n) || n < 0) {
			return null;
		}
		return roundGatewayMoney(n);
	}
	return null;
}

/**
 * 从 catalog entry 对象规范化三单价。
 * - 仅有 `cost` → 三列 = cost
 * - 部分三字段 → 缺省按 charged → cost → standard → metered → defaultCost 回退
 * - strict：任一显式字段非法 → `null`；宽松模式非法字段忽略
 */
export function normalizeToolUnitPrices(
	rec: Record<string, unknown>,
	defaultCost: number,
	strict: boolean
): ToolUnitPrices | null {
	const costParsed = parseToolMoneyField(rec.cost);
	const meteredParsed = parseToolMoneyField(rec.metered);
	const standardParsed = parseToolMoneyField(rec.standard);
	const chargedParsed = parseToolMoneyField(rec.charged);

	const hasCostKey = rec.cost !== undefined && rec.cost !== null && rec.cost !== '';
	const hasMeteredKey = rec.metered !== undefined && rec.metered !== null && rec.metered !== '';
	const hasStandardKey = rec.standard !== undefined && rec.standard !== null && rec.standard !== '';
	const hasChargedKey = rec.charged !== undefined && rec.charged !== null && rec.charged !== '';

	if (strict) {
		if (hasCostKey && costParsed == null) return null;
		if (hasMeteredKey && meteredParsed == null) return null;
		if (hasStandardKey && standardParsed == null) return null;
		if (hasChargedKey && chargedParsed == null) return null;
	}

	const anyTriple = hasMeteredKey || hasStandardKey || hasChargedKey;
	if (!anyTriple && !hasCostKey) {
		const d = roundGatewayMoney(defaultCost);
		return { metered: d, standard: d, charged: d };
	}

	if (!anyTriple && hasCostKey) {
		const c = costParsed ?? roundGatewayMoney(defaultCost);
		return { metered: c, standard: c, charged: c };
	}

	const fallbackChain = (): number => {
		if (chargedParsed != null) return chargedParsed;
		if (costParsed != null) return costParsed;
		if (standardParsed != null) return standardParsed;
		if (meteredParsed != null) return meteredParsed;
		return roundGatewayMoney(defaultCost);
	};
	const fb = fallbackChain();

	return {
		metered: meteredParsed ?? fb,
		standard: standardParsed ?? fb,
		charged: chargedParsed ?? costParsed ?? fb,
	};
}

/** 写出 catalog 时带齐三字段 + legacy cost。 */
export function toToolPricingFields(prices: ToolUnitPrices): ToolPricingFields {
	const metered = roundGatewayMoney(prices.metered);
	const standard = roundGatewayMoney(prices.standard);
	const charged = roundGatewayMoney(prices.charged);
	return { metered, standard, charged, cost: charged };
}

/** 按计费单元数缩放三单价 → 写入 request log 的 totals。 */
export function scaleToolUnitPrices(prices: ToolUnitPrices, billingUnits: number): ToolUnitPrices {
	const units = Number.isFinite(billingUnits) && billingUnits > 0 ? billingUnits : 0;
	return {
		metered: roundGatewayMoney(prices.metered * units),
		standard: roundGatewayMoney(prices.standard * units),
		charged: roundGatewayMoney(prices.charged * units),
	};
}

export type FixedToolCostPricingAudit = {
	v: 4;
	kind: 'fixed_tool_cost';
	tool_id: string;
	/** REST 工具为 request / chars；MCP 为规则里的计费单元名。 */
	unit: string;
	billing_units: number;
	unit_prices: ToolUnitPrices;
	totals: {
		metered_cost: number;
		standard_cost: number;
		charged_cost: number;
	};
	provider?: string;
	[key: string]: unknown;
};

export function buildFixedToolCostPricingAudit(options: {
	toolId: string;
	unit: string;
	billingUnits: number;
	unitPrices: ToolUnitPrices;
	totals: ToolUnitPrices;
	extra?: Record<string, unknown>;
}): FixedToolCostPricingAudit {
	const { provider, ...rest } = options.extra ?? {};
	return {
		v: 4,
		kind: 'fixed_tool_cost',
		tool_id: options.toolId,
		unit: options.unit,
		billing_units: options.billingUnits,
		unit_prices: {
			metered: roundGatewayMoney(options.unitPrices.metered),
			standard: roundGatewayMoney(options.unitPrices.standard),
			charged: roundGatewayMoney(options.unitPrices.charged),
		},
		totals: {
			metered_cost: roundGatewayMoney(options.totals.metered),
			standard_cost: roundGatewayMoney(options.totals.standard),
			charged_cost: roundGatewayMoney(options.totals.charged),
		},
		...(typeof provider === 'string' && provider.trim() ? { provider: provider.trim() } : {}),
		...rest,
	};
}
