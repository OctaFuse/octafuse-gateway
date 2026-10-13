/** Versioned MCP pricing stored in the existing JSON column. Only request billing is enabled. */
import {
	parseToolMoneyField,
	parseToolPriceFactor,
	resolveToolFactorPrices,
	scaleToolUnitPrices,
	type ToolUnitPrices,
} from '../lib/tool-pricing';

export const MCP_PRICING_RULE_VERSION = 2;

export class McpPricingRuleError extends Error {
	constructor(readonly at: string, message: string) {
		super(`${at}: ${message}`);
		this.name = 'McpPricingRuleError';
	}
}

type McpPricingEnvelope = {
	/** Selects a registered billing mode. Future modes use config without database changes. */
	unit: string;
	config: Record<string, unknown>;
};

export type McpFactorPricingRule = McpPricingEnvelope & {
	v: typeof MCP_PRICING_RULE_VERSION;
	standard: number;
	chargedFactor: number;
	meteredFactor: number;
};

/** Legacy API/read compatibility: preserve independent prices, including a zero standard price. */
export type McpLegacyPricingRule = McpPricingEnvelope & { v: 1; prices: ToolUnitPrices };
export type McpPricingRule = McpFactorPricingRule | McpLegacyPricingRule;

export type McpPricingQuote = {
	unit: string;
	units: number;
	unitPrices: ToolUnitPrices;
	totals: ToolUnitPrices;
};

export type McpPricingSummary = ToolUnitPrices & { unit: string };

/** Future modes own their config validation and their pre-call / successful-call measurement. */
export type McpPricingMode = {
	parseConfig: (raw: Record<string, unknown>) => Record<string, unknown>;
	preflight: (config: Readonly<Record<string, unknown>>, args: Record<string, unknown>) => number;
	settle: (
		config: Readonly<Record<string, unknown>>,
		args: Record<string, unknown>,
		result: Record<string, unknown>
	) => number;
};

const PRICING_MODES: Readonly<Record<string, McpPricingMode>> = {
	request: {
		parseConfig(raw) {
			if (Object.keys(raw).length)
				throw new McpPricingRuleError('pricing.config', 'request billing has no configuration');
			return {};
		},
		preflight: () => 1,
		settle: () => 1,
	},
};

function pricingMode(unit: string): McpPricingMode {
	if (!Object.prototype.hasOwnProperty.call(PRICING_MODES, unit)) {
		throw new McpPricingRuleError('pricing.unit', `unsupported billing mode: ${unit}`);
	}
	return PRICING_MODES[unit];
}

function object(raw: unknown, at: string): Record<string, unknown> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw))
		throw new McpPricingRuleError(at, 'must be an object');
	return raw as Record<string, unknown>;
}

function parsePrice(raw: unknown, at: string): number {
	const parsed = parseToolMoneyField(raw);
	if (parsed == null || !Number.isFinite(parsed))
		throw new McpPricingRuleError(at, 'must be a non-negative number');
	return parsed;
}

/** Read old per-request JSON directly; reject legacy behavior that would change the charge. */
function checkLegacyFields(record: Record<string, unknown>): void {
	if (
		record.base != null &&
		record.base !== '' &&
		(!['number', 'string'].includes(typeof record.base) || Number(record.base) !== 1)
	) {
		throw new McpPricingRuleError('pricing.base', 'only one request per successful call is supported');
	}
	for (const key of ['terms', 'guards']) {
		const value = record[key];
		if (value != null && (!Array.isArray(value) || value.length !== 0)) {
			throw new McpPricingRuleError(`pricing.${key}`, 'is no longer supported');
		}
	}
	for (const key of ['min', 'max', 'estimate']) {
		if (record[key] != null && record[key] !== '')
			throw new McpPricingRuleError(`pricing.${key}`, 'is no longer supported');
	}
}

function parseFactor(raw: unknown, at: string): number {
	const value = parseToolPriceFactor(raw);
	if (value == null) throw new McpPricingRuleError(at, 'must be a non-negative finite number');
	return value;
}

/** Resolve amounts once at ledger precision; factors themselves retain their precision. */
export function resolveMcpUnitPrices(rule: McpPricingRule): ToolUnitPrices {
	if (rule.v === 1) return { ...rule.prices };
	try {
		return resolveToolFactorPrices(rule);
	} catch {
		throw new McpPricingRuleError('pricing', 'resolved amounts exceed ledger range');
	}
}

export function parseMcpPricingRule(raw: unknown): McpPricingRule {
	const record = object(raw, 'pricing');
	const version = record.v === undefined ? 1 : record.v;
	if (version !== 1 && version !== MCP_PRICING_RULE_VERSION)
		throw new McpPricingRuleError('pricing.v', 'must be 1 or 2');
	const unit = record.unit === undefined || record.unit === '' ? 'request' : record.unit;
	if (typeof unit !== 'string') throw new McpPricingRuleError('pricing.unit', 'must be a string');
	const mode = pricingMode(unit);
	const allowed = new Set(
		version === 1
			? ['v', 'unit', 'prices', 'config', 'base', 'terms', 'guards', 'min', 'max', 'estimate']
			: ['v', 'unit', 'standard', 'chargedFactor', 'meteredFactor', 'config']
	);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new McpPricingRuleError(`pricing.${key}`, 'is not supported');
	}
	const config = mode.parseConfig(record.config === undefined ? {} : object(record.config, 'pricing.config'));
	if (version === 1) {
		checkLegacyFields(record);
		const prices = object(record.prices, 'pricing.prices');
		return {
			v: 1,
			unit,
			config,
			prices: {
				metered: parsePrice(prices.metered, 'pricing.prices.metered'),
				standard: parsePrice(prices.standard, 'pricing.prices.standard'),
				charged: parsePrice(prices.charged, 'pricing.prices.charged'),
			},
		};
	}
	const rule: McpFactorPricingRule = {
		v: MCP_PRICING_RULE_VERSION,
		unit,
		config,
		standard: parsePrice(record.standard, 'pricing.standard'),
		chargedFactor: parseFactor(
			record.chargedFactor === undefined ? 1 : record.chargedFactor,
			'pricing.chargedFactor'
		),
		meteredFactor: parseFactor(
			record.meteredFactor === undefined ? 1 : record.meteredFactor,
			'pricing.meteredFactor'
		),
	};
	resolveMcpUnitPrices(rule);
	return rule;
}

export function perCallMcpPricingRule(
	standard = 0,
	chargedFactor = 1,
	meteredFactor = 1
): McpFactorPricingRule {
	return parseMcpPricingRule({
		v: MCP_PRICING_RULE_VERSION,
		unit: 'request',
		standard,
		chargedFactor,
		meteredFactor,
	}) as McpFactorPricingRule;
}

export function parseStoredMcpPricingRule(raw: string): McpPricingRule {
	let value: unknown;
	try {
		value = JSON.parse(raw) as unknown;
	} catch {
		throw new McpPricingRuleError('pricing', 'is not valid JSON');
	}
	return parseMcpPricingRule(value);
}

export function serializeMcpPricingRule(rule: McpPricingRule): string {
	return JSON.stringify(parseMcpPricingRule(rule));
}

export function summarizeMcpPricingRule(rule: McpPricingRule): McpPricingSummary {
	return { unit: rule.unit, ...resolveMcpUnitPrices(rule) };
}

function quote(rule: McpPricingRule, units: number): McpPricingQuote {
	if (!Number.isFinite(units) || units < 0)
		throw new McpPricingRuleError('pricing.units', 'must be a non-negative finite number');
	const prices = resolveMcpUnitPrices(rule);
	return {
		unit: rule.unit,
		units,
		unitPrices: prices,
		totals: scaleToolUnitPrices(prices, units),
	};
}

export function preflightMcpPricing(rule: McpPricingRule, args: Record<string, unknown>): McpPricingQuote {
	return quote(rule, pricingMode(rule.unit).preflight(rule.config, args));
}

/** The caller invokes settlement only after a successful tools/call. */
export function settleMcpPricing(
	rule: McpPricingRule,
	args: Record<string, unknown>,
	result: Record<string, unknown>
): McpPricingQuote {
	return quote(rule, pricingMode(rule.unit).settle(rule.config, args, result));
}
