/**
 * `api_key_request_logs.status = error` 时可选的企业微信 / 飞书群机器人告警（`system_config` 非空 URL 即启用）。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	ALERT_WEBHOOK_FEISHU_URL_KEY,
	ALERT_WEBHOOK_WECOM_URL_KEY,
	getSystemConfigValue,
} from '@octafuse/core';

const DEFAULT_TIMEOUT_MS = 8000;

/** 企业微信群机器人 `text` 单条上限约 2048 字节；预留余量 */
const WECOM_TEXT_MAX_CHARS = 1800;

export type GatewayErrorAlertContext = {
	requestLogId: string;
	apiKeyId: string;
	userEmail: string | null;
	modelId: string;
	providerId: string;
	providerModelName: string | null | undefined;
	routeGroup: string;
	requestProtocol: string;
	upstreamProtocol: string;
	errorMessage: string | null | undefined;
	latencyMs: number | null | undefined;
};

function truncateForAlert(s: string, maxLen: number): string {
	const t = s.trim();
	if (t.length <= maxLen) {
		return t;
	}
	return `${t.slice(0, maxLen)}…`;
}

function buildPlainSummary(ctx: GatewayErrorAlertContext): string {
	const err = truncateForAlert(ctx.errorMessage ?? '(no message)', 600);
	const email = ctx.userEmail ?? '(null)';
	const pm = ctx.providerModelName ?? '(null)';
	const lines = [
		'[Gateway] api_key_request_logs status=error',
		`request_log_id: ${ctx.requestLogId}`,
		`api_key_id: ${ctx.apiKeyId}`,
		`user_email: ${email}`,
		`model_id: ${ctx.modelId}`,
		`provider_id: ${ctx.providerId}`,
		`provider_model_name: ${pm}`,
		`route_group: ${ctx.routeGroup}`,
		`request_protocol: ${ctx.requestProtocol}`,
		`upstream_protocol: ${ctx.upstreamProtocol}`,
		`latency_ms: ${ctx.latencyMs ?? '(null)'}`,
		`error_message: ${err}`,
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
	const plain = buildPlainSummary(ctx);
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
