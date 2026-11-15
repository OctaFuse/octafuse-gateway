/**
 * Shared predicates for admin request-log list filters.
 * LIKE uses a backslash escape so `%` and `_` in a prefix stay literal.
 */

import { MODEL_KINDS, type ModelKind } from './model-kind';

export function escapeSqlLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * 把 ISO 8601 时刻转成 D1 / MySQL 比较用的 UTC 文本：毫秒非零时 `YYYY-MM-DD HH:mm:ss.SSS`，整秒时省略 `.000`。
 * D1 的 `created_at` 是秒级文本，按字典序比较：`'…:23' < '…:23.123'`，所以带毫秒的边界与秒级值比较正确；
 * 但整秒边界若写成 `'…:23.000'`，同一秒的秒级值（`'…:23'`）会被判为更小，起点那一秒被漏掉、终点那一秒被多算。
 * 整秒时去掉 `.000`，秒级值与边界相等，半开区间 `[start, end)` 的语义才与按毫秒比较一致。MySQL 的 DATETIME 按时间值比较，两种写法等价。
 */
export function isoToSqlUtcMillis(iso: string): string {
	const text = new Date(iso).toISOString().slice(0, 23).replace('T', ' ');
	return text.endsWith('.000') ? text.slice(0, -4) : text;
}

export function appendProviderIdsCondition(
	conditions: string[],
	bindValues: unknown[],
	column: string,
	providerIds: string[] | undefined,
): void {
	const ids = (providerIds ?? []).map((id) => id.trim()).filter((id) => id !== '');
	if (ids.length === 0) return;
	conditions.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
	bindValues.push(...ids);
}

/**
 * 两级多选的「供应商」筛选：命中任一 `provider_id`，或属于任一供应商类型。
 * 类型按当前供应商目录解析，写成子查询，一个类型只占一个绑定参数；空串是「未分类」。
 * `alias` 是表别名前缀（`'rl.'` 或空串）。两项都没给或清洗后都为空时不加条件。
 */
export function appendProviderScopeCondition(
	conditions: string[],
	bindValues: unknown[],
	alias: string,
	scope: { providerIds?: string[]; kinds?: string[] },
): void {
	const column = `${alias}provider_id`;
	const ids = cleanIds(scope.providerIds);
	const kinds = [...new Set((scope.kinds ?? []).map((kind) => kind.trim()))];
	const parts: string[] = [];
	if (ids.length > 0) parts.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
	if (kinds.length > 0) {
		parts.push(
			`${column} IN (SELECT p.id FROM providers p WHERE COALESCE(p.kind, '') IN (${kinds.map(() => '?').join(', ')}))`,
		);
	}
	if (parts.length === 0) return;
	conditions.push(parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`);
	bindValues.push(...ids, ...kinds);
}

/**
 * 两级多选的「模型」筛选：命中任一 `model_id`，或属于任一模型厂商（`models.vendor`）。
 * 厂商按当前模型目录解析，写成子查询；已不在目录里的模型不属于任何厂商，只能按 `model_id` 选中。
 */
export function appendModelScopeCondition(
	conditions: string[],
	bindValues: unknown[],
	alias: string,
	scope: { modelIds?: string[]; vendors?: string[] },
): void {
	const column = `${alias}model_id`;
	const ids = cleanIds(scope.modelIds);
	const vendors = cleanIds(scope.vendors);
	const parts: string[] = [];
	if (ids.length > 0) parts.push(`${column} IN (${ids.map(() => '?').join(', ')})`);
	if (vendors.length > 0) {
		parts.push(`${column} IN (SELECT m.id FROM models m WHERE m.vendor IN (${vendors.map(() => '?').join(', ')}))`);
	}
	if (parts.length === 0) return;
	conditions.push(parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`);
	bindValues.push(...ids, ...vendors);
}

/** 模型目录里各非 LLM 类型的 `model_id`。日志本身看不出类型时用它判断。 */
export type RequestLogModelKindCatalog = Partial<Record<Exclude<ModelKind, 'llm'>, string[]>>;

/**
 * 请求日志列表的「任一组命中」条件：组内各项是 AND，组与组之间是 OR。
 * 「类型」多选靠它表达并集，例如「图像模型的请求，或某个 REST 工具，或某个 MCP 服务」。
 */
export type RequestLogMatchGroup = {
	providerIds?: string[];
	/** 排除这些 `provider_id`。没有 `provider_id` 的日志（未选出上游就失败的请求）保留。 */
	excludeProviderIds?: string[];
	modelIds?: string[];
	excludeModelIds?: string[];
	/** `model_id` 前缀，`%`、`_`、`\` 按字面量匹配。 */
	modelIdPrefix?: string;
	/** 按模型请求的类型匹配，见 `requestLogModelKindCase`。 */
	modelKinds?: { kinds: string[]; catalog: RequestLogModelKindCatalog };
};

function cleanIds(ids: string[] | undefined): string[] {
	return [...new Set((ids ?? []).map((id) => id.trim()).filter((id) => id !== ''))];
}

/** 目录判断的先后顺序，与 `requestLogFeatureKind` 一致。 */
const CATALOG_KIND_ORDER = ['embedding', 'image', 'tts', 'asr'] as const;

/**
 * 推断一条模型请求日志的类型的 CASE 表达式。类型不落库，按顺序看：
 * 计费类型 → 入站 / 上游操作名 → 模型目录里的模型类型 → `audio_tokens` 计费算 `asr` → 其余算 `llm`。
 *
 * 规则与管理后台请求日志列表的类型标签相同，改动时两处一起改：
 * `packages/admin/app/gateway/request-logs/request-log-display.ts` 的 `requestLogFeatureKind`。
 * 工具调用不在这里区分，由调用方先按 `provider_id` 排除。
 */
export function requestLogModelKindCase(alias: string, catalog: RequestLogModelKindCatalog, bindValues: unknown[]): string {
	const billing = `COALESCE(${alias}billing_kind, '')`;
	const operations = [`COALESCE(${alias}request_operation, '')`, `COALESCE(${alias}upstream_operation, '')`];
	const operationHas = (text: string) => operations.map((operation) => `${operation} LIKE '%${text}%'`).join(' OR ');
	const whens = [
		`WHEN ${billing} IN ('image_per_image', 'image_tokens') THEN 'image'`,
		`WHEN ${billing} = 'audio_per_character' THEN 'tts'`,
		`WHEN ${billing} = 'audio_per_second' THEN 'asr'`,
		`WHEN ${operationHas('images.')} THEN 'image'`,
		`WHEN ${operationHas('audio.speech')} THEN 'tts'`,
		`WHEN ${operationHas('audio.transcriptions')} THEN 'asr'`,
		`WHEN ${operations.map((operation) => `${operation} IN ('embeddings', 'models.embed')`).join(' OR ')} THEN 'embedding'`,
	];
	for (const kind of CATALOG_KIND_ORDER) {
		const ids = cleanIds(catalog[kind]);
		if (ids.length === 0) continue;
		whens.push(`WHEN ${alias}model_id IN (${ids.map(() => '?').join(', ')}) THEN '${kind}'`);
		bindValues.push(...ids);
	}
	// `audio_tokens` 同时用于 ASR 与按 Token 计费的 TTS，单看计费分不出来，只作最后兜底。
	whens.push(`WHEN ${billing} = 'audio_tokens' THEN 'asr'`);
	return `CASE ${whens.join(' ')} ELSE 'llm' END`;
}

/**
 * `groups` 为 `undefined` 时不加条件；为空数组时一条也不匹配。
 * 某一组没有任何条件时它匹配全部日志，整个并集恒真，同样不加条件。
 * `providerIds` / `modelIds` / `modelKinds.kinds` 给了但清洗后为空的组不匹配任何日志，直接跳过。
 * `alias` 是表别名前缀（`'rl.'` 或空串）。
 */
export function appendAnyOfCondition(
	conditions: string[],
	bindValues: unknown[],
	alias: string,
	groups: RequestLogMatchGroup[] | undefined,
	dialect?: 'mysql',
): void {
	if (groups === undefined) return;
	const providerColumn = `${alias}provider_id`;
	const modelColumn = `${alias}model_id`;
	const clauses: string[] = [];
	const binds: unknown[] = [];
	for (const group of groups) {
		const parts: string[] = [];
		const groupBinds: unknown[] = [];
		let matchesNothing = false;
		for (const [column, ids] of [
			[providerColumn, group.providerIds],
			[modelColumn, group.modelIds],
		] as const) {
			if (ids === undefined) continue;
			const cleaned = cleanIds(ids);
			if (cleaned.length === 0) {
				matchesNothing = true;
				break;
			}
			parts.push(`${column} IN (${cleaned.map(() => '?').join(', ')})`);
			groupBinds.push(...cleaned);
		}
		const modelKinds = group.modelKinds
			? MODEL_KINDS.filter((kind) => group.modelKinds!.kinds.includes(kind))
			: undefined;
		if (matchesNothing || modelKinds?.length === 0) continue;
		for (const [column, ids] of [
			[providerColumn, group.excludeProviderIds],
			[modelColumn, group.excludeModelIds],
		] as const) {
			const cleaned = cleanIds(ids);
			if (cleaned.length === 0) continue;
			// NULL 与 NOT IN 比较得到 NULL，要单独放行。
			parts.push(`(${column} IS NULL OR ${column} NOT IN (${cleaned.map(() => '?').join(', ')}))`);
			groupBinds.push(...cleaned);
		}
		appendModelIdPrefixCondition(parts, groupBinds, modelColumn, group.modelIdPrefix, dialect);
		// 五种类型选全就是不按类型筛，不必拼 CASE。类型名来自固定列表，直接写进 SQL。
		if (modelKinds && modelKinds.length < MODEL_KINDS.length) {
			const kindCase = requestLogModelKindCase(alias, group.modelKinds!.catalog, groupBinds);
			parts.push(`${kindCase} IN (${modelKinds.map((kind) => `'${kind}'`).join(', ')})`);
		}
		if (parts.length === 0) return;
		clauses.push(parts.length === 1 ? parts[0] : `(${parts.join(' AND ')})`);
		binds.push(...groupBinds);
	}
	conditions.push(clauses.length === 0 ? '1 = 0' : clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`);
	bindValues.push(...binds);
}

export function appendModelIdPrefixCondition(
	conditions: string[],
	bindValues: unknown[],
	column: string,
	prefix: string | undefined,
	dialect?: 'mysql',
): void {
	const trimmed = prefix?.trim() ?? '';
	if (trimmed === '') return;
	// MySQL 默认把反斜杠当字符串转义符，转义字符本身要写成 '\\'，写成 '\' 会变成未闭合字符串。
	const escapeLiteral = dialect === 'mysql' ? "'\\\\'" : "'\\'";
	conditions.push(`${column} LIKE ? ESCAPE ${escapeLiteral}`);
	bindValues.push(`${escapeSqlLike(trimmed)}%`);
}
