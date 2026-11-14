/**
 * 内置确认页：没有配置外部同意页（`MCP_OAUTH_CONSENT_URL`）的 Gateway 实例用它完成授权。
 * 用户粘贴自己的 `sk-` API Key 证明身份并点同意；Key 只用于识别用户，不会存储或回显。
 * 配置了外部同意页时本页返回 404，避免绕过外部页的登录策略。
 * 页面无外部依赖（内联样式、无脚本），按 Accept-Language 显示中文或英文。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
	acceptAuthorizationRequest,
	consumeRateLimitLayers,
	describeAuthorizationRequest,
	readMcpOAuthMode,
	rejectAuthorizationRequest,
	type AuthorizationRequestView,
} from '@octafuse/core';
import type { Env } from '../app';
import { authenticateApiKey } from '../services/api-key-auth';
import { requestClientIp } from './oauth-server';

export const oauthConsentRoutes = new Hono<Env>();

type Lang = 'zh' | 'en';

const TEXT = {
	en: {
		title: 'Authorize access',
		intro: 'wants to connect to your account through the Model Context Protocol (MCP).',
		scope: 'It will be able to call the MCP tools available to your account, and usage is billed to your account.',
		redirect: 'After you decide, this page sends you back to',
		keyLabel: 'Your API key (sk-…)',
		keyHint: 'Used only to confirm who you are. It is not stored.',
		approve: 'Authorize',
		deny: 'Deny',
		unnamedNote: 'The application name is reported by the client and has not been verified.',
		invalidKey: 'The API key is invalid.',
		tooMany: 'Too many attempts. Please wait a minute and try again.',
		notPending: 'This authorization request has expired or was already handled. Go back to the application and start again.',
		notFound: 'Authorization request not found.',
		generic: 'Something went wrong. Go back to the application and start again.',
	},
	zh: {
		title: '授权访问',
		intro: '请求通过 MCP（模型上下文协议）连接你的账号。',
		scope: '授权后它可以调用你账号可用的 MCP 工具，用量计入你的账号。',
		redirect: '确认后将返回到',
		keyLabel: '你的 API Key（sk-…）',
		keyHint: '仅用于确认你的身份，不会被保存。',
		approve: '同意授权',
		deny: '拒绝',
		unnamedNote: '应用名称由客户端自行上报，未经验证。',
		invalidKey: 'API Key 无效。',
		tooMany: '尝试次数过多，请等一分钟后再试。',
		notPending: '这个授权请求已过期或已处理。请回到应用重新发起。',
		notFound: '找不到这个授权请求。',
		generic: '出错了，请回到应用重新发起。',
	},
} as const;

function pickLang(header: string | undefined): Lang {
	return /^\s*zh/i.test(header ?? '') ? 'zh' : 'en';
}

const escapeHtml = (value: string): string =>
	value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

function redirectLabel(uri: string): string {
	try {
		const url = new URL(uri);
		return url.host ? `${url.protocol}//${url.host}` : `${url.protocol}`;
	} catch {
		return uri;
	}
}

const HEADERS: Record<string, string> = {
	'Content-Type': 'text/html; charset=utf-8',
	'Cache-Control': 'no-store',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY',
	'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};

const STYLE = `body{font:16px/1.5 system-ui,sans-serif;background:#f5f6f8;margin:0;padding:24px;color:#1b1f24}
main{max-width:440px;margin:8vh auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 16px}p{margin:0 0 12px}.muted{color:#5b6570;font-size:14px}
.app{font-weight:600}label{display:block;font-weight:600;margin:16px 0 4px}
input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c5cbd3;border-radius:8px;font-size:15px}
.row{display:flex;gap:12px;margin-top:20px}button{flex:1;padding:10px;border-radius:8px;font-size:15px;cursor:pointer;border:1px solid #c5cbd3;background:#fff}
button.primary{background:#1b1f24;color:#fff;border-color:#1b1f24}.error{color:#b42318;margin-bottom:12px}`;

function page(lang: Lang, body: string, status: 200 | 400 | 404 | 409 | 429 = 200): Response {
	const t = TEXT[lang];
	const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(t.title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
	return new Response(html, { status, headers: HEADERS });
}

const errorPage = (lang: Lang, message: string, status: 400 | 404 | 409 | 429): Response =>
	page(lang, `<h1>${escapeHtml(TEXT[lang].title)}</h1><p class="error">${escapeHtml(message)}</p>`, status);

function form(lang: Lang, request: AuthorizationRequestView, error?: string): Response {
	const t = TEXT[lang];
	const name = escapeHtml(request.app_name ?? request.client_name);
	const note = request.app_name ? '' : `<p class="muted">${escapeHtml(t.unnamedNote)}</p>`;
	return page(
		lang,
		`<h1>${escapeHtml(t.title)}</h1>
<p><span class="app">${name}</span> ${escapeHtml(t.intro)}</p>${note}
<p>${escapeHtml(t.scope)}</p>
<p class="muted">${escapeHtml(t.redirect)} ${escapeHtml(redirectLabel(request.redirect_uri))}</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth/consent" autocomplete="off">
<input type="hidden" name="request_id" value="${escapeHtml(request.id)}">
<label for="api_key">${escapeHtml(t.keyLabel)}</label>
<input id="api_key" name="api_key" type="password" autocomplete="off" spellcheck="false">
<p class="muted">${escapeHtml(t.keyHint)}</p>
<div class="row"><button type="submit" name="decision" value="deny">${escapeHtml(t.deny)}</button>
<button class="primary" type="submit" name="decision" value="approve">${escapeHtml(t.approve)}</button></div>
</form>`
	);
}

async function guard(c: Context<Env>, lang: Lang): Promise<Response | null> {
	const mode = await readMcpOAuthMode(c.get('repositories'));
	if (mode.mode !== 'builtin' || mode.consentUrl) return errorPage(lang, TEXT[lang].notFound, 404);
	return null;
}

oauthConsentRoutes.get('/', async (c) => {
	const lang = pickLang(c.req.header('Accept-Language'));
	const blocked = await guard(c, lang);
	if (blocked) return blocked;
	const id = c.req.query('request_id')?.trim() ?? '';
	if (!id) return errorPage(lang, TEXT[lang].notFound, 404);
	const result = await describeAuthorizationRequest(c.get('repositories'), id);
	if (!result.ok) return errorPage(lang, TEXT[lang].notFound, 404);
	if (result.request.status !== 'pending') return errorPage(lang, TEXT[lang].notPending, 409);
	return form(lang, result.request);
});

oauthConsentRoutes.post('/', async (c) => {
	const lang = pickLang(c.req.header('Accept-Language'));
	const blocked = await guard(c, lang);
	if (blocked) return blocked;
	const { exceeded } = await consumeRateLimitLayers([{ subject: `oauth:consent:${requestClientIp(c)}`, rpm: 20 }]);
	if (exceeded) return errorPage(lang, TEXT[lang].tooMany, 429);

	const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
	const text = (name: string) => (typeof body[name] === 'string' ? (body[name] as string).trim() : '');
	const id = text('request_id');
	const decision = text('decision');
	const repos = c.get('repositories');

	const described = id ? await describeAuthorizationRequest(repos, id) : null;
	if (!described || !described.ok) return errorPage(lang, TEXT[lang].notFound, 404);
	if (described.request.status !== 'pending') return errorPage(lang, TEXT[lang].notPending, 409);

	if (decision === 'deny') {
		const rejected = await rejectAuthorizationRequest(repos, id);
		if (!rejected.ok) return errorPage(lang, TEXT[lang].notPending, 409);
		return c.redirect(rejected.redirect_uri, 303);
	}
	if (decision !== 'approve') return errorPage(lang, TEXT[lang].generic, 400);

	const apiKey = text('api_key');
	const auth = apiKey ? await authenticateApiKey(repos, apiKey) : null;
	if (!auth) return form(lang, described.request, TEXT[lang].invalidKey);
	const accepted = await acceptAuthorizationRequest(repos, id, auth.userId);
	if (!accepted.ok) {
		return errorPage(lang, accepted.code === 'request_not_pending' ? TEXT[lang].notPending : TEXT[lang].generic, 409);
	}
	return c.redirect(accepted.redirect_uri, 303);
});
