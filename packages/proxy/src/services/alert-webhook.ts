/**
 * `api_key_request_logs.status = error` 时可选的企业微信 / 飞书群机器人告警（`system_config` 非空 URL 即启用）。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	ALERT_WEBHOOK_FEISHU_URL_KEY,
	ALERT_WEBHOOK_WECOM_URL_KEY,
	getSystemConfigValue,
} from '@octafuse/core';
import { isSensitiveContentErrorMessage } from './sensitive-content-detector';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';

const DEFAULT_TIMEOUT_MS = 8000;

/** 企业微信群机器人 `text` 单条上限约 2048 字节；预留余量 */
const WECOM_TEXT_MAX_CHARS = 1800;

/** 超长延迟阈值（毫秒），用于辅助判定上游超时 */
const LONG_LATENCY_MS = 120_000;

export type GatewayErrorAlertCategory =
	| 'upstream_timeout'
	| 'provider_auth'
	| 'provider_rate_limit'
	| 'provider_server_error'
	| 'sensitive_content'
	| 'client_or_model_error'
	| 'route_config_error'
	| 'unknown_error';

export type GatewayErrorAlertContext = {
	requestLogId: string;
	apiKeyId: string;
	userEmail: string | null;
	modelId: string;
	/** 请求当时 `models.display_name` 快照；缺省则回退 `modelId` */
	modelName?: string | null;
	providerId: string;
	/** 请求当时 `providers.name` 快照；缺省则回退 `providerId` */
	providerName?: string | null;
	providerModelName: string | null | undefined;
	routeGroup: string;
	requestProtocol: string;
	upstreamProtocol: string;
	errorMessage: string | null | undefined;
	latencyMs: number | null | undefined;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
	upstreamRequestId?: string | null;
	/** 请求发生时间（ISO 8601 UTC）；缺省则在构建告警时取当前时刻 */
	occurredAt?: string | null;
	/** 本次错误触发的熔断措施 */
	circuitEvents?: GatewayCircuitAlertEvent[];
};

type AlertCategoryMeta = {
	category: GatewayErrorAlertCategory;
	label: string;
	priority: 'P1' | 'P2' | 'P3';
	summaryHint: string;
	suggestion: string;
};

const CATEGORY_META: Record<GatewayErrorAlertCategory, Omit<AlertCategoryMeta, 'category'>> = {
	upstream_timeout: {
		label: '上游超时',
		priority: 'P1',
		summaryHint: '疑似上游或边缘超时',
		suggestion:
			'优先检查上游响应耗时、Cloudflare 524、模型 max_tokens/流式输出长度；必要时切换路由或降级模型',
	},
	provider_auth: {
		label: '供应商鉴权',
		priority: 'P1',
		summaryHint: '上游 key 或权限异常',
		suggestion: '检查 provider key 是否失效、权限范围及模型可用性；必要时轮换 key',
	},
	provider_rate_limit: {
		label: '供应商限流',
		priority: 'P2',
		summaryHint: '触发上游限流或配额',
		suggestion: '检查 key 池额度、供应商 rate limit；观察 failover 是否已切换 key/provider',
	},
	provider_server_error: {
		label: '供应商故障',
		priority: 'P2',
		summaryHint: '上游 5xx 服务异常',
		suggestion: '观察供应商稳定性；必要时切换 provider 或路由',
	},
	sensitive_content: {
		label: '敏感内容拦截',
		priority: 'P3',
		summaryHint: '上游内容安全策略拦截',
		suggestion: '检查用户输入、系统提示词与生成目标；必要时优化提示词或引导用户调整内容',
	},
	client_or_model_error: {
		label: '请求/模型错误',
		priority: 'P3',
		summaryHint: '客户端请求或模型配置问题',
		suggestion: '检查请求体、模型名、路由配置及 openai/anthropic/gemini 协议转换',
	},
	route_config_error: {
		label: '路由配置',
		priority: 'P1',
		summaryHint: '无可用路由或协议不匹配',
		suggestion: '检查模型路由启用状态、provider 绑定及 upstream_protocol 配置',
	},
	unknown_error: {
		label: '未知错误',
		priority: 'P3',
		summaryHint: '未能自动归类',
		suggestion: '查看原始错误与 request_log_id，在 Admin 请求日志中进一步排查',
	},
};

function truncateForAlert(s: string, maxLen: number): string {
	const t = s.trim();
	if (t.length <= maxLen) {
		return t;
	}
	return `${t.slice(0, maxLen)}…`;
}

function extractHttpStatus(errorMessage: string | null | undefined): number | null {
	if (!errorMessage) {
		return null;
	}
	const m = errorMessage.match(/\bHTTP\s+(\d{3})\b/i);
	if (!m) {
		return null;
	}
	const code = Number.parseInt(m[1]!, 10);
	return Number.isFinite(code) ? code : null;
}

function errorMessageLower(errorMessage: string | null | undefined): string {
	return (errorMessage ?? '').toLowerCase();
}

function hasTimeoutSignal(errorMessage: string | null | undefined, latencyMs: number | null | undefined): boolean {
	const lower = errorMessageLower(errorMessage);
	if (/\b524\b/.test(lower) || lower.includes('timeout') || lower.includes('timed out')) {
		return true;
	}
	if (lower.includes('stream usage timeout') || lower.includes('stream ended before usage')) {
		return true;
	}
	if (latencyMs != null && latencyMs >= LONG_LATENCY_MS) {
		const httpStatus = extractHttpStatus(errorMessage);
		// 超长耗时仅在无明确客户端错误码，或边缘/网关超时类 status 时归为超时
		if (
			httpStatus == null ||
			httpStatus === 524 ||
			httpStatus === 502 ||
			httpStatus === 503 ||
			httpStatus === 504
		) {
			return true;
		}
	}
	return false;
}

function hasRouteConfigSignal(errorMessage: string | null | undefined): boolean {
	const lower = errorMessageLower(errorMessage);
	return (
		lower.includes('no routes configured') ||
		lower.includes('no supported upstream protocol route available') ||
		lower.includes('no active keys for provider')
	);
}

function hasAuthSignal(errorMessage: string | null | undefined, httpStatus: number | null): boolean {
	if (httpStatus === 401 || httpStatus === 403) {
		return true;
	}
	const lower = errorMessageLower(errorMessage);
	return (
		lower.includes('invalid api key') ||
		lower.includes('invalid key') ||
		lower.includes('permission denied') ||
		lower.includes('unauthorized') ||
		lower.includes('authentication')
	);
}

function hasRateLimitSignal(errorMessage: string | null | undefined, httpStatus: number | null): boolean {
	if (httpStatus === 429) {
		return true;
	}
	const lower = errorMessageLower(errorMessage);
	return lower.includes('rate limit') || lower.includes('quota') || lower.includes('too many requests');
}

/**
 * 基于 `error_message` 与耗时对 Gateway 错误告警做轻量分类。
 */
export function classifyGatewayErrorAlert(ctx: GatewayErrorAlertContext): AlertCategoryMeta {
	const err = ctx.errorMessage ?? '';
	const httpStatus = extractHttpStatus(err);

	if (hasRouteConfigSignal(err)) {
		return { category: 'route_config_error', ...CATEGORY_META.route_config_error };
	}
	if (hasTimeoutSignal(err, ctx.latencyMs ?? null)) {
		return { category: 'upstream_timeout', ...CATEGORY_META.upstream_timeout };
	}
	if (hasAuthSignal(err, httpStatus)) {
		return { category: 'provider_auth', ...CATEGORY_META.provider_auth };
	}
	if (hasRateLimitSignal(err, httpStatus)) {
		return { category: 'provider_rate_limit', ...CATEGORY_META.provider_rate_limit };
	}
	if (httpStatus != null && httpStatus >= 500 && httpStatus !== 524) {
		return { category: 'provider_server_error', ...CATEGORY_META.provider_server_error };
	}
	if (isSensitiveContentErrorMessage(err)) {
		return { category: 'sensitive_content', ...CATEGORY_META.sensitive_content };
	}
	if (httpStatus != null && (httpStatus === 400 || httpStatus === 404 || httpStatus === 422)) {
		return { category: 'client_or_model_error', ...CATEGORY_META.client_or_model_error };
	}
	return { category: 'unknown_error', ...CATEGORY_META.unknown_error };
}

function formatLatency(latencyMs: number | null | undefined): string {
	if (latencyMs == null) {
		return '未知';
	}
	if (latencyMs >= 1000) {
		return `${(latencyMs / 1000).toFixed(1)}s`;
	}
	return `${latencyMs}ms`;
}

function displayModel(ctx: GatewayErrorAlertContext): string {
	const name = (ctx.modelName ?? '').trim();
	return name || ctx.modelId;
}

function displayProvider(ctx: GatewayErrorAlertContext): string {
	const name = (ctx.providerName ?? '').trim();
	return name || ctx.providerId;
}

function formatSupplierLine(ctx: GatewayErrorAlertContext): string {
	const provider = displayProvider(ctx);
	const upstreamModel = ctx.providerModelName ?? '(null)';
	const route = ctx.routeGroup;
	const fp = (ctx.providerKeyFingerprint ?? '').trim();
	const routeKey = fp ? `${route} (${fp})` : `${route} (未记录)`;
	return `${provider} · ${upstreamModel} · ${routeKey} · `;
}

const ALERT_OCCURRED_TIME_ZONE = 'Asia/Shanghai';

function formatOccurredAt(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return iso;
	}
	const formatted = new Intl.DateTimeFormat('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
		timeZone: ALERT_OCCURRED_TIME_ZONE,
	}).format(date);
	return `${formatted} (UTC+8)`;
}

function formatCircuitFailureKind(kind: string): string {
	switch (kind) {
		case 'rate_limit':
			return 'rate_limit';
		case 'auth':
			return 'auth';
		case 'server':
			return 'server';
		default:
			return kind;
	}
}

function formatCircuitDurationSeconds(cooldownMs: number): string {
	const seconds = Math.max(1, Math.ceil(cooldownMs / 1000));
	return `${seconds}s`;
}

function formatCircuitEventLine(event: GatewayCircuitAlertEvent): string {
	const recoverAt = formatOccurredAt(new Date(event.openUntil).toISOString());
	const duration = formatCircuitDurationSeconds(event.cooldownMs);
	if (event.kind === 'provider_key') {
		const label = (event.keyLabel ?? '').trim() || '(未记录)';
		const fingerprint = (event.keyFingerprint ?? '').trim() || '(未记录)';
		return `provider_key keyId=${event.keyId} label=${label} fingerprint=${fingerprint} reason=${formatCircuitFailureKind(event.failureKind)}，持续 ${duration}，恢复时间 ${recoverAt}`;
	}
	return `user_model user=${event.userId} model=${event.modelId} reason=${event.reason}，持续 ${duration}，恢复时间 ${recoverAt}`;
}

function buildCircuitMeasuresSection(ctx: GatewayErrorAlertContext): string[] {
	const events = ctx.circuitEvents ?? [];
	if (events.length === 0) {
		return [];
	}
	return ['熔断措施:', ...events.map((event) => `- ${formatCircuitEventLine(event)}`), ''];
}

function buildSummaryLine(meta: AlertCategoryMeta, ctx: GatewayErrorAlertContext): string {
	const errShort = truncateForAlert(ctx.errorMessage ?? '(no message)', 120);
	const latency = formatLatency(ctx.latencyMs ?? null);
	const httpStatus = extractHttpStatus(ctx.errorMessage);
	const statusPart = httpStatus != null ? `HTTP ${httpStatus}` : errShort;
	return `${statusPart}，耗时 ${latency}，${meta.summaryHint}`;
}

/**
 * 构建结构化告警文本（企业微信 / 飞书 text 消息）。
 */
export function buildGatewayErrorAlertSummary(ctx: GatewayErrorAlertContext): string {
	const meta = classifyGatewayErrorAlert(ctx);
	const model = displayModel(ctx);
	const email = ctx.userEmail ?? '(匿名/未知)';
	const protocolPath = `${ctx.requestProtocol} → ${ctx.upstreamProtocol}`;
	const errFull = truncateForAlert(ctx.errorMessage ?? '(no message)', 600);

	const occurredAt = formatOccurredAt(ctx.occurredAt?.trim() || new Date().toISOString());

	const lines = [
		`[Gateway] - [${meta.label}] - [${meta.priority}]`,
		'',
		`模型: ${model}`,
		`摘要: ${buildSummaryLine(meta, ctx)}`,
		`影响: ${email} · route=${ctx.routeGroup} · ${protocolPath}`,
		`供应商: ${formatSupplierLine(ctx)}`,
		'',
		...buildCircuitMeasuresSection(ctx),
		`原始错误: ${errFull}`,
		`建议: ${meta.suggestion}`,
		`发生时间: ${occurredAt}`,
	];
	return lines.join('\n');
}

async function postJsonWithTimeout(url: string, body: unknown, timeoutMs: number): Promise<Response> {
	const ac = new AbortController();
	const tid = setTimeout(() => ac.abort(), timeoutMs);
	try {
		return await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json; charset=utf-8' },
			body: JSON.stringify(body),
			signal: ac.signal,
		});
	} finally {
		clearTimeout(tid);
	}
}

async function sendWeComRobot(webhookUrl: string, content: string, timeoutMs: number): Promise<void> {
	const res = await postJsonWithTimeout(
		webhookUrl,
		{ msgtype: 'text', text: { content } },
		timeoutMs
	);
	const bodyText = await res.text();
	let parsed: { errcode?: number; errmsg?: string } = {};
	try {
		parsed = JSON.parse(bodyText) as { errcode?: number; errmsg?: string };
	} catch {
		// ignore
	}
	if (!res.ok) {
		throw new Error(`WeCom HTTP ${res.status}: ${truncateForAlert(bodyText, 200)}`);
	}
	if (parsed.errcode != null && parsed.errcode !== 0) {
		throw new Error(`WeCom errcode=${parsed.errcode} errmsg=${parsed.errmsg ?? ''}`);
	}
}

async function sendFeishuBot(webhookUrl: string, text: string, timeoutMs: number): Promise<void> {
	const res = await postJsonWithTimeout(
		webhookUrl,
		{ msg_type: 'text', content: { text } },
		timeoutMs
	);
	const raw = await res.text();
	let parsed: { StatusCode?: number; code?: number; msg?: string } = {};
	try {
		parsed = JSON.parse(raw) as { StatusCode?: number; code?: number; msg?: string };
	} catch {
		// ignore
	}
	if (!res.ok) {
		throw new Error(`Feishu HTTP ${res.status}: ${truncateForAlert(raw, 200)}`);
	}
	const code = parsed.StatusCode ?? parsed.code;
	if (code != null && code !== 0) {
		throw new Error(`Feishu code=${code} msg=${parsed.msg ?? ''}`);
	}
}

/**
 * 读取 `system_config` 中的 Webhook URL；未配置则立即返回。
 * 由调用方在 `recordUsage` 内 `await`（同在 `waitUntil` 链上），失败由调用方 `.catch` 打日志，不阻断写库。
 */
export async function fireGatewayErrorWebhooks(repos: GatewayRepositories, ctx: GatewayErrorAlertContext): Promise<void> {
	const [wecomRaw, feishuRaw] = await Promise.all([
		getSystemConfigValue(repos, ALERT_WEBHOOK_WECOM_URL_KEY),
		getSystemConfigValue(repos, ALERT_WEBHOOK_FEISHU_URL_KEY),
	]);
	const wecomUrl = (wecomRaw ?? '').trim();
	const feishuUrl = (feishuRaw ?? '').trim();
	if (!wecomUrl && !feishuUrl) {
		return;
	}
	const plain = buildGatewayErrorAlertSummary(ctx);
	const wecomPlain = truncateForAlert(plain, WECOM_TEXT_MAX_CHARS);
	const feishuPlain = truncateForAlert(plain, WECOM_TEXT_MAX_CHARS);
	const timeoutMs = DEFAULT_TIMEOUT_MS;
	const tasks: Promise<void>[] = [];
	if (wecomUrl) {
		tasks.push(sendWeComRobot(wecomUrl, wecomPlain, timeoutMs));
	}
	if (feishuUrl) {
		tasks.push(sendFeishuBot(feishuUrl, feishuPlain, timeoutMs));
	}
	await Promise.all(tasks);
}
