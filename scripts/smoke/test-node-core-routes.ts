import { pathToFileURL } from 'node:url';

/**
 * Node + SQL（Postgres / MySQL 等）网关核心链路冒烟：不调用上游模型。
 *
 * - Proxy：`GET /health`、`GET /v1/models`（可选 API key）
 * - Admin（可选）：`GET /api/admin/config`、`GET /dashboard`（HTML 壳）
 * - 关键写路径（Admin 存在时）：
 *   ① `POST /api/admin/keys` 创建临时冒烟 key → 验证创建成功
 *   ② `GET /api/admin/budget-audit-logs` 校验 `key_created` 审计
 *   ③ `GET /api/admin/keys` 确认列表 `data` 数组
 *   ④ `POST /api/admin/users/:id/keys` 第二把 key；`GET .../keys` 确认 ≥2
 *   ⑤ `DELETE /api/admin/users/:id` 级联清理（失败则回退逐个删 key）
 *
 * 环境变量：
 * - GATEWAY_BASE_URL — Proxy 根 URL，默认 http://127.0.0.1:8787
 * - GATEWAY_API_KEY — 可选；未设置时跳过 `GET /v1/models`；与库内 sk 不一致时该请求仅警告
 * - GATEWAY_MASTER_URL — Admin 根 URL；未设时默认 http://127.0.0.1:8789（仍受下方开关约束）
 * - GATEWAY_MASTER_KEY — 管理 API Bearer；可与 `MASTER_KEY` 二选一
 * - GATEWAY_SMOKE_SKIP_ADMIN=1 — 只测 Proxy（不请求 Admin）
 * - GATEWAY_SMOKE_SKIP_WRITES=1 — 跳过关键写路径（Admin 只读冒烟）
 *
 * 兼容：`npm run test:gateway:postgres-smoke` 仍指向本脚本（旧名保留为 re-export）。
 */

const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:8787';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY?.trim() ?? '';

const GATEWAY_MASTER_URL = process.env.GATEWAY_MASTER_URL ?? 'http://127.0.0.1:8789';
const SKIP_ADMIN = ['1', 'true', 'yes'].includes(
	(process.env.GATEWAY_SMOKE_SKIP_ADMIN ?? '').toLowerCase()
);
const SKIP_WRITES = ['1', 'true', 'yes'].includes(
	(process.env.GATEWAY_SMOKE_SKIP_WRITES ?? '').toLowerCase()
);

function smokeLabel(): string {
	const d = process.env.DATABASE_DRIVER?.trim();
	if (d && d !== 'd1') {
		return `[gateway-node-smoke:${d}]`;
	}
	return '[gateway-node-smoke]';
}

function resolveMasterKey(): string | undefined {
	const k =
		process.env.GATEWAY_MASTER_KEY?.trim() || process.env.MASTER_KEY?.trim();
	if (k) {
		return k;
	}
	if (process.env.NODE_ENV === 'production') {
		return undefined;
	}
	// 与 migrations-mysql / Postgres seed 中默认 MASTER_KEY 对齐，便于本地/compose 一键验证
	return 'sk-dev-admin-key';
}

function base(url: string): string {
	return url.replace(/\/$/, '');
}

async function assertOk(res: Response, label: string): Promise<void> {
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${label} failed: ${res.status} ${text.slice(0, 500)}`);
	}
}

/**
 * 测试关键写路径：通过 Admin API 创建 key → 审计 → 列表确认 → 同用户第二 key → 删用户清理。
 */
async function smokeWritePaths(adminBase: string, masterKey: string, tag: string): Promise<void> {
	const smokeExt = `smoke-${Date.now()}`;
	const smokeEmail = `${smokeExt}@smoke.local`;

	console.log('%s [write] POST /api/admin/keys (createApiKeyWithAudit)', tag);
	const createRes = await fetch(`${adminBase}/api/admin/keys`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${masterKey}`,
		},
		body: JSON.stringify({
			external_system: 'gateway-smoke',
			external_user_id: smokeExt,
			email: smokeEmail,
			reason: 'node gateway smoke',
		}),
	});
	await assertOk(createRes, 'POST /api/admin/keys');
	const created = (await createRes.json()) as {
		success?: boolean;
		data?: { key_id?: string; id?: string; key?: string; user_id?: string };
	};
	const keyId = created.data?.key_id ?? created.data?.id;
	const keyValue = created.data?.key;
	const userId = created.data?.user_id;
	if (!keyId || !keyValue || !userId) {
		throw new Error(
			`POST /api/admin/keys: 响应缺少 data.key_id / data.key / data.user_id，实际：${JSON.stringify(created).slice(0, 400)}`
		);
	}
	console.log('%s [write] POST /api/admin/keys ok (key_id=%s user_id=%s)', tag, keyId, userId);

	console.log('%s [write] GET /api/admin/budget-audit-logs (user snapshot audit)', tag);
	const auditListUrl = `${adminBase}/api/admin/budget-audit-logs?${new URLSearchParams({
		user_id: userId,
		event_type: 'key_created',
		source: 'key_provision',
		page: '1',
		page_size: '10',
	}).toString()}`;
	const auditRes = await fetch(auditListUrl, {
		headers: { Authorization: `Bearer ${masterKey}` },
	});
	await assertOk(auditRes, 'GET /api/admin/budget-audit-logs');
	const auditJson = (await auditRes.json()) as {
		success?: boolean;
		data?: Array<{
			event_type?: string;
			source?: string | null;
			before_user_snapshot?: string | null;
			after_user_snapshot?: string | null;
			changed_fields?: string | null;
		}>;
	};
	const rows = auditJson.data ?? [];
	const enriched = rows.find(
		(r) =>
			r.event_type === 'key_created' &&
			r.source === 'key_provision' &&
			typeof r.before_user_snapshot === 'string' &&
			r.before_user_snapshot.length > 2 &&
			typeof r.after_user_snapshot === 'string' &&
			r.after_user_snapshot.length > 2
	);
	if (!enriched) {
		throw new Error(
			`GET /api/admin/budget-audit-logs: 未找到带 user snapshot 的 key_created（source=key_provision），rows=${rows.length}`
		);
	}
	console.log('%s [write] audit log snapshot ok (key_created + key_provision)', tag);

	// 用刚创建的 key 访问 /v1/models，间接触发 api-key-auth（读 api_keys 表）
	console.log('%s [write] GET /v1/models with new sk (api-key-auth read)', tag);
	const modelsWithNewKey = await fetch(`${base(GATEWAY_BASE_URL)}/v1/models`, {
		headers: { Authorization: `Bearer ${keyValue}` },
	});
	if (!modelsWithNewKey.ok) {
		console.warn('%s [write] GET /v1/models with new sk not ok (%s) — 可能是无路由配置，属预期', tag, modelsWithNewKey.status);
	} else {
		console.log('%s [write] GET /v1/models with new sk ok', tag);
	}

	// 通过 Admin 查询列表，确认 key 已写入（读路径验证）
	console.log('%s [write] GET /api/admin/keys?email=%s (confirm write)', tag, smokeEmail);
	const listRes = await fetch(
		`${adminBase}/api/admin/keys?email=${encodeURIComponent(smokeEmail)}`,
		{ headers: { Authorization: `Bearer ${masterKey}` } }
	);
	await assertOk(listRes, 'GET /api/admin/keys (confirm write)');
	const list = (await listRes.json()) as { data?: unknown[] };
	const keysArr = Array.isArray(list.data) ? list.data : [];
	if (keysArr.length === 0) {
		throw new Error(`GET /api/admin/keys confirm: 未查到刚写入的 key（smokeEmail=${smokeEmail}）`);
	}
	console.log('%s [write] confirm write ok (found %d key(s))', tag, keysArr.length);

	console.log('%s [write] POST /api/admin/users/%s/keys (second key, same user)', tag, userId);
	const key2Res = await fetch(`${adminBase}/api/admin/users/${encodeURIComponent(userId)}/keys`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${masterKey}`,
		},
		body: JSON.stringify({ name: 'smoke-second-key', reason: 'node gateway smoke second' }),
	});
	await assertOk(key2Res, 'POST /api/admin/users/:id/keys');
	const key2Json = (await key2Res.json()) as { data?: { key_id?: string } };
	const key2Id = key2Json.data?.key_id;
	if (!key2Id) {
		throw new Error(`POST user keys: 缺少 data.key_id，实际：${JSON.stringify(key2Json).slice(0, 400)}`);
	}
	console.log('%s [write] second key ok (key_id=%s)', tag, key2Id);

	console.log('%s [write] GET /api/admin/users/%s/keys (expect 2 keys)', tag, userId);
	const userKeysRes = await fetch(
		`${adminBase}/api/admin/users/${encodeURIComponent(userId)}/keys`,
		{ headers: { Authorization: `Bearer ${masterKey}` } }
	);
	await assertOk(userKeysRes, 'GET /api/admin/users/:id/keys');
	const userKeysJson = (await userKeysRes.json()) as { data?: unknown[] };
	const userKeys = Array.isArray(userKeysJson.data) ? userKeysJson.data : [];
	if (userKeys.length < 2) {
		throw new Error(
			`GET /api/admin/users/:id/keys: 期望至少 2 条 key，实际 ${userKeys.length}，body=${JSON.stringify(userKeysJson).slice(0, 400)}`
		);
	}
	console.log('%s [write] user keys ok (count=%d)', tag, userKeys.length);

	// 删除临时用户（级联删除其 api_keys；验证多 key 清理路径）
	console.log('%s [write] DELETE /api/admin/users/%s (cleanup cascade)', tag, userId);
	const delUserRes = await fetch(`${adminBase}/api/admin/users/${encodeURIComponent(userId)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${masterKey}` },
	});
	if (!delUserRes.ok) {
		console.warn('%s [write] DELETE user warn: %s — 回退删除 key', tag, delUserRes.status);
		const deleteRes = await fetch(`${adminBase}/api/admin/keys/${keyId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${masterKey}` },
		});
		if (!deleteRes.ok) {
			console.warn('%s [write] DELETE key warn: %s', tag, deleteRes.status);
		}
		await fetch(`${adminBase}/api/admin/keys/${key2Id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${masterKey}` },
		}).catch(() => undefined);
	} else {
		console.log('%s [write] DELETE user ok (cascade keys)', tag);
	}
}

export async function runNodeGatewaySmoke(): Promise<void> {
	const tag = smokeLabel();
	console.log('%s proxy=%s', tag, base(GATEWAY_BASE_URL));

	const health = await fetch(`${base(GATEWAY_BASE_URL)}/health`);
	await assertOk(health, 'GET /health');
	console.log('%s GET /health ok', tag);

	if (!GATEWAY_API_KEY) {
		console.warn('%s skip GET /v1/models（未设置 GATEWAY_API_KEY）', tag);
	} else {
		const models = await fetch(`${base(GATEWAY_BASE_URL)}/v1/models`, {
			headers: { Authorization: `Bearer ${GATEWAY_API_KEY}` },
		});
		if (!models.ok) {
			console.warn(
				`%s GET /v1/models not ok (${models.status}) — 检查 GATEWAY_API_KEY 是否为库内存在的 sk`,
				tag
			);
		} else {
			console.log('%s GET /v1/models ok', tag);
		}
	}

	if (SKIP_ADMIN) {
		console.log('%s skip admin (GATEWAY_SMOKE_SKIP_ADMIN)', tag);
		console.log('%s done', tag);
		return;
	}

	const masterKey = resolveMasterKey();
	const adminBase = base(GATEWAY_MASTER_URL);
	if (!masterKey) {
		console.warn(
			'%s skip admin — 请设置 GATEWAY_MASTER_KEY 或 MASTER_KEY（生产环境不设默认 seed key）',
			tag
		);
		console.log('%s done', tag);
		return;
	}

	const config = await fetch(`${adminBase}/api/admin/config`, {
		headers: { Authorization: `Bearer ${masterKey}` },
	});
	await assertOk(config, 'GET /api/admin/config');
	console.log('%s GET /api/admin/config ok', tag);

	const dash = await fetch(`${adminBase}/dashboard`, {
		headers: { Accept: 'text/html,application/xhtml+xml' },
	});
	await assertOk(dash, 'GET /dashboard');
	const ct = dash.headers.get('content-type') ?? '';
	if (!ct.includes('text/html')) {
		throw new Error(`GET /dashboard: expected HTML, got content-type=${ct}`);
	}
	console.log('%s GET /dashboard ok (HTML)', tag);

	if (SKIP_WRITES) {
		console.log('%s skip write paths (GATEWAY_SMOKE_SKIP_WRITES)', tag);
	} else {
		await smokeWritePaths(adminBase, masterKey, tag);
	}

	console.log('%s done', tag);
}

async function main(): Promise<void> {
	await runNodeGatewaySmoke();
}

const isMainModule =
	typeof process.argv[1] === 'string' &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	main().catch((err) => {
		console.error(smokeLabel(), err);
		process.exit(1);
	});
}
