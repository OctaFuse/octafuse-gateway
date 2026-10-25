/**
 * 网关维护模式：`system_config.MAINTENANCE_MODE`（JSON 文本）。
 *
 * 开启后 Proxy 对推理入口返回 503（友好提示 + `Retry-After`），Admin 可选拒绝写接口。
 * 数据迁移的"核心切换"依赖它冻结写入；它本身也可单独用于任何维护窗口。
 *
 * 进程内缓存 {@link MAINTENANCE_MODE_CACHE_TTL_MS}（比其它 system_config 缓存短，开关要尽快生效）。
 * 键缺失、空串或 JSON 非法一律视为未开启，保证读取失败不会误伤线上流量。
 */

import type { GatewayRepositories } from '../storage/repositories-types';

export const MAINTENANCE_MODE_KEY = 'MAINTENANCE_MODE';
export const MAINTENANCE_MODE_CACHE_TTL_MS = 5_000;

/** `message` / `messages` 单条上限，避免把超长文本塞进每个错误响应。 */
export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500;
/** 单次维护最长预计时长（分钟）；超过多半是填错单位。 */
export const MAINTENANCE_MAX_DURATION_MINUTES = 7 * 24 * 60;
/** 未设置预计结束时间，或已超过预计结束时间时的 `Retry-After` 秒数。 */
export const MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS = 30;
/** `Retry-After` 上限；预计时间很远时让客户端定期重试而不是睡很久。 */
export const MAINTENANCE_MAX_RETRY_AFTER_SECONDS = 300;

export interface MaintenanceConfig {
	enabled: boolean;
	/** 默认提示；可含 `{minutes}`。空串表示使用内置文案。 */
	message: string;
	/** 按语言覆盖：key 为 `zh` / `en` / `zh-CN` 等，匹配请求的 `Accept-Language`。 */
	messages: Record<string, string>;
	/** ISO 8601 UTC；null 表示不承诺恢复时间。 */
	expected_end_at: string | null;
	/** 开启时 Admin 的写接口（除维护开关、集成密钥、调试台）返回 503。 */
	block_admin_writes: boolean;
}

export const DISABLED_MAINTENANCE_CONFIG: MaintenanceConfig = Object.freeze({
	enabled: false,
	message: '',
	messages: Object.freeze({}) as Record<string, string>,
	expected_end_at: null,
	block_admin_writes: true,
});

const BUILTIN_MESSAGE_EN_WITH_ETA = 'The gateway is under maintenance and is expected to be back in about {minutes} minutes. Please try again later.';
const BUILTIN_MESSAGE_EN = 'The gateway is under maintenance. Please try again later.';
const BUILTIN_MESSAGE_ZH_WITH_ETA = '网关维护中，预计 {minutes} 分钟后恢复，请稍后再试';
const BUILTIN_MESSAGE_ZH = '网关维护中，请稍后再试';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLangKey(key: string): string {
	return key.trim().toLowerCase().replace(/_/g, '-');
}

function normalizeMessages(value: unknown): Record<string, string> {
	if (!isPlainObject(value)) return {};
	const out: Record<string, string> = {};
	for (const [rawKey, rawText] of Object.entries(value)) {
		if (typeof rawText !== 'string') continue;
		const key = normalizeLangKey(rawKey);
		const text = rawText.trim();
		if (!key || !text) continue;
		out[key] = text.slice(0, MAINTENANCE_MESSAGE_MAX_LENGTH);
	}
	return out;
}

function normalizeEndAt(value: unknown): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * 宽松解析（运行时读取）：任何异常都回退为未开启。
 */
export function parseMaintenanceConfig(raw: string | null | undefined): MaintenanceConfig {
	const text = (raw ?? '').trim();
	if (!text) return DISABLED_MAINTENANCE_CONFIG;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return DISABLED_MAINTENANCE_CONFIG;
	}
	if (!isPlainObject(parsed) || parsed.enabled !== true) return DISABLED_MAINTENANCE_CONFIG;
	return {
		enabled: true,
		message: typeof parsed.message === 'string' ? parsed.message.trim().slice(0, MAINTENANCE_MESSAGE_MAX_LENGTH) : '',
		messages: normalizeMessages(parsed.messages),
		expected_end_at: normalizeEndAt(parsed.expected_end_at),
		block_admin_writes: parsed.block_admin_writes !== false,
	};
}

export interface MaintenanceConfigInput {
	enabled?: unknown;
	message?: unknown;
	messages?: unknown;
	/** 与 `duration_minutes` 二选一；`duration_minutes` 由服务端按当前时间折算，避免依赖浏览器时钟。 */
	expected_end_at?: unknown;
	duration_minutes?: unknown;
	block_admin_writes?: unknown;
}

/**
 * 严格校验（Admin 写入）：不合法时抛 `Error`，由调用方转成 400。
 * 关闭维护时只写 `{"enabled":false}`，不保留旧文案，避免下次误带上过期时间。
 */
export function buildMaintenanceConfigFromInput(input: MaintenanceConfigInput, now: Date = new Date()): MaintenanceConfig {
	if (typeof input.enabled !== 'boolean') {
		throw new Error('enabled must be a boolean');
	}
	if (!input.enabled) {
		return DISABLED_MAINTENANCE_CONFIG;
	}

	let message = '';
	if (input.message !== undefined && input.message !== null) {
		if (typeof input.message !== 'string') throw new Error('message must be a string');
		message = input.message.trim();
		if (message.length > MAINTENANCE_MESSAGE_MAX_LENGTH) {
			throw new Error(`message must be at most ${MAINTENANCE_MESSAGE_MAX_LENGTH} characters`);
		}
	}

	let messages: Record<string, string> = {};
	if (input.messages !== undefined && input.messages !== null) {
		if (!isPlainObject(input.messages)) throw new Error('messages must be an object of language -> text');
		for (const [key, text] of Object.entries(input.messages)) {
			if (typeof text !== 'string') throw new Error(`messages.${key} must be a string`);
			if (text.trim().length > MAINTENANCE_MESSAGE_MAX_LENGTH) {
				throw new Error(`messages.${key} must be at most ${MAINTENANCE_MESSAGE_MAX_LENGTH} characters`);
			}
		}
		messages = normalizeMessages(input.messages);
	}

	let expectedEndAt: string | null = null;
	const hasEndAt = input.expected_end_at !== undefined && input.expected_end_at !== null && input.expected_end_at !== '';
	const hasDuration = input.duration_minutes !== undefined && input.duration_minutes !== null && input.duration_minutes !== '';
	if (hasEndAt && hasDuration) {
		throw new Error('Provide either expected_end_at or duration_minutes, not both');
	}
	if (hasDuration) {
		const minutes = typeof input.duration_minutes === 'number' ? input.duration_minutes : Number(input.duration_minutes);
		if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAINTENANCE_MAX_DURATION_MINUTES) {
			throw new Error(`duration_minutes must be a positive number up to ${MAINTENANCE_MAX_DURATION_MINUTES}`);
		}
		expectedEndAt = new Date(now.getTime() + Math.round(minutes * 60_000)).toISOString();
	} else if (hasEndAt) {
		if (typeof input.expected_end_at !== 'string') throw new Error('expected_end_at must be an ISO 8601 string');
		const ms = Date.parse(input.expected_end_at);
		if (!Number.isFinite(ms)) throw new Error('expected_end_at must be a valid ISO 8601 time');
		if (ms - now.getTime() > MAINTENANCE_MAX_DURATION_MINUTES * 60_000) {
			throw new Error('expected_end_at is too far in the future');
		}
		expectedEndAt = new Date(ms).toISOString();
	}

	if (input.block_admin_writes !== undefined && typeof input.block_admin_writes !== 'boolean') {
		throw new Error('block_admin_writes must be a boolean');
	}

	return {
		enabled: true,
		message,
		messages,
		expected_end_at: expectedEndAt,
		block_admin_writes: input.block_admin_writes !== false,
	};
}

export function serializeMaintenanceConfig(config: MaintenanceConfig): string {
	if (!config.enabled) return JSON.stringify({ enabled: false });
	return JSON.stringify({
		enabled: true,
		message: config.message,
		messages: config.messages,
		expected_end_at: config.expected_end_at,
		block_admin_writes: config.block_admin_writes,
	});
}

/** 距预计结束的整分钟数（向上取整，至少 1）；没有预计时间或已过期返回 null。 */
export function maintenanceRemainingMinutes(config: MaintenanceConfig, now: Date = new Date()): number | null {
	if (!config.expected_end_at) return null;
	const remainingMs = Date.parse(config.expected_end_at) - now.getTime();
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
	return Math.max(1, Math.ceil(remainingMs / 60_000));
}

/** 响应头 `Retry-After`（秒）。 */
export function maintenanceRetryAfterSeconds(config: MaintenanceConfig, now: Date = new Date()): number {
	if (!config.expected_end_at) return MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS;
	const remainingMs = Date.parse(config.expected_end_at) - now.getTime();
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) return MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS;
	return Math.min(MAINTENANCE_MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(remainingMs / 1000)));
}

/**
 * 解析 `Accept-Language`，按 q 值降序返回小写语言标签（`zh-cn`、`en`…）。
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
	if (!header) return [];
	const entries: Array<{ tag: string; q: number; order: number }> = [];
	header.split(',').forEach((part, order) => {
		const [rawTag, ...params] = part.trim().split(';');
		const tag = normalizeLangKey(rawTag ?? '');
		if (!tag || tag === '*') return;
		let q = 1;
		for (const param of params) {
			const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
			if (match) {
				const parsed = Number(match[1]);
				if (Number.isFinite(parsed)) q = parsed;
			}
		}
		if (q <= 0) return;
		entries.push({ tag, q, order });
	});
	return entries.sort((a, b) => b.q - a.q || a.order - b.order).map((entry) => entry.tag);
}

function fillMinutes(template: string, minutes: number | null): string {
	return template.replace(/\{minutes\}/g, String(minutes ?? ''));
}

/**
 * 选出本次请求要展示的提示文案。
 *
 * 优先级：`messages` 精确/主语言匹配 → `message` → 内置（`zh*` 用中文，其余英文）。
 * 模板含 `{minutes}` 但当前没有可用的预计时间时，退回不带时间的内置文案，避免出现"预计  分钟"。
 */
export function resolveMaintenanceMessage(
	config: MaintenanceConfig,
	acceptLanguage: string | null | undefined,
	now: Date = new Date()
): string {
	const minutes = maintenanceRemainingMinutes(config, now);
	const languages = parseAcceptLanguage(acceptLanguage);

	let template = '';
	for (const tag of languages) {
		const exact = config.messages[tag];
		if (exact) {
			template = exact;
			break;
		}
		const primary = config.messages[tag.split('-')[0] ?? ''];
		if (primary) {
			template = primary;
			break;
		}
	}
	if (!template) template = config.message;

	const preferChinese = (languages[0] ?? 'zh').startsWith('zh');
	// 没有自定义模板，或模板依赖 {minutes} 但当前没有预计时间：用内置文案。
	if (!template || (template.includes('{minutes}') && minutes === null)) {
		if (preferChinese) return minutes === null ? BUILTIN_MESSAGE_ZH : fillMinutes(BUILTIN_MESSAGE_ZH_WITH_ETA, minutes);
		return minutes === null ? BUILTIN_MESSAGE_EN : fillMinutes(BUILTIN_MESSAGE_EN_WITH_ETA, minutes);
	}
	return fillMinutes(template, minutes);
}

type CacheEntry = { value: MaintenanceConfig; expiresAt: number };
let cache: CacheEntry | null = null;

export function resetMaintenanceModeCacheForTests(): void {
	cache = null;
}

/** Admin 保存后调用，让同进程立即看到新值（其它进程仍等 TTL）。 */
export function invalidateMaintenanceModeCache(): void {
	cache = null;
}

/**
 * 读取维护配置（带进程内缓存）。读库失败时抛出，调用方自行决定 fail-open。
 */
export async function getMaintenanceConfig(repos: Pick<GatewayRepositories, 'systemConfig'>): Promise<MaintenanceConfig> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) return cache.value;
	const raw = await repos.systemConfig.getConfig(MAINTENANCE_MODE_KEY);
	const value = parseMaintenanceConfig(raw);
	cache = { value, expiresAt: now + MAINTENANCE_MODE_CACHE_TTL_MS };
	return value;
}
