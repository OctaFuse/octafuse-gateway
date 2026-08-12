/**
 * `user_audit_logs` 写入契约：Event / Actor / Cause（source + reason）正交枚举与归一化。
 * 历史行可能仍为旧 `source`（如 usage_charge）；新写入经 {@link assertAndFinalizeUserAuditInsert} 统一。
 */
import type { ApiKeyBudgetAuditActorType } from '../types';
import type { InsertUserAuditLogParams } from './user-audit-logs-types';

/** 权威业务事件（`event_type`） */
export const USER_AUDIT_EVENT_TYPES = [
	'usage_charge',
	'period_reset',
	'admin_adjust',
	'key_created',
	'key_revoked',
	'key_deleted',
	'user_created',
	'user_deleted',
] as const;

/** 来源通道（`source`）：入口/通路，不与 `event_type` 混用 */
export const USER_AUDIT_SOURCE_CHANNELS = [
	'gateway_usage',
	'gateway_auth',
	'gateway_user_service',
	'gateway_key_service',
	'key_provision',
	'gateway_user_provision',
	'admin_users',
	/** Admin `POST /users/:id/budget/transition`（结转/换档预算迁移） */
	'admin_budget_transition',
	'admin_keys',
	'admin_user_key',
	/** 历史兼容：仅归一化读入，新写入不应再产生 */
	'usage_charge',
	'period_reset',
] as const;

export type UserAuditSourceChannel = (typeof USER_AUDIT_SOURCE_CHANNELS)[number];

export const USER_AUDIT_ACTOR_TYPES = ['system', 'admin', 'service'] as const satisfies readonly ApiKeyBudgetAuditActorType[];

/**
 * `actor_id` 的身份前缀。`actor_type` 只区分类别（admin / system / service），
 * 同一类别下仍有多个身份实例——例如 `admin` 既包含控制台会话，也包含每一把集成密钥，
 * 追责与泄露回溯依赖此前缀 + 完整 `actor_id`。
 */
export const USER_AUDIT_ACTOR_KINDS = ['console', 'admin_key', 'admin', 'system', 'service'] as const;

export type UserAuditActorKind = (typeof USER_AUDIT_ACTOR_KINDS)[number];

const ACTOR_KIND_SET = new Set<string>(USER_AUDIT_ACTOR_KINDS);

/** 过滤出合法的 actor kind，去重；非法值静默丢弃。 */
export function normalizeUserAuditActorKinds(values: readonly string[]): UserAuditActorKind[] {
	return [...new Set(values.filter((value): value is UserAuditActorKind => ACTOR_KIND_SET.has(value)))];
}

/**
 * `actor_id LIKE 'kind:%'` 的等价半开区间 `[lower, upper)`。
 *
 * 不用 LIKE 有两个原因：`admin_key` 含下划线，在 LIKE 中是单字符通配符，需要 ESCAPE 子句，
 * 而 ESCAPE 的反斜杠字面量写法在 Postgres 与 MySQL 之间并不一致；区间比较则同样能走
 * `(actor_id, created_at)` 索引，且没有转义歧义。
 */
export function userAuditActorKindPrefixRange(kind: UserAuditActorKind): { lower: string; upper: string } {
	const separator = ':';
	const nextChar = String.fromCharCode(separator.charCodeAt(0) + 1);
	return { lower: `${kind}${separator}`, upper: `${kind}${nextChar}` };
}

/** 系统自动化（扣费、周期重置等） */
export const SYSTEM_GATEWAY_ACTOR_ID = 'system:gateway';

/** 管理端以 Gateway Master Key 调用 */
export const ADMIN_GATEWAY_MASTER_ACTOR_ID = 'admin:gateway_master_key';

/** 用户幂等创建（getOrCreateUser 等） */
export const SERVICE_USER_PROVISION_ACTOR_ID = 'service:user_provision';

const EVENT_SET = new Set<string>(USER_AUDIT_EVENT_TYPES);
const SOURCE_SET = new Set<string>(USER_AUDIT_SOURCE_CHANNELS);
const ACTOR_TYPE_SET = new Set<string>(USER_AUDIT_ACTOR_TYPES);

function mapLegacySource(source: string | null | undefined): string | null {
	if (source == null || source === '') return null;
	if (source === 'usage_charge') return 'gateway_usage';
	return source;
}

/**
 * 校验并归一化审计插入参数；在仓储 `insertUserAuditLog` 内统一调用。
 * @throws Error 当 event_type / actor_type / source 不在契约内时
 */
export function assertAndFinalizeUserAuditInsert(params: InsertUserAuditLogParams): InsertUserAuditLogParams {
	if (params.userId == null || params.userId === '') {
		throw new Error('user_audit_logs: userId is required for insert');
	}
	const eventType = params.eventType;
	if (!EVENT_SET.has(eventType)) {
		throw new Error(`user_audit_logs: invalid event_type "${eventType}"`);
	}
	const actorType = params.actorType;
	if (!ACTOR_TYPE_SET.has(actorType)) {
		throw new Error(`user_audit_logs: invalid actor_type "${actorType}"`);
	}
	let source = mapLegacySource(params.source ?? null);
	if (source != null && source !== '' && !SOURCE_SET.has(source)) {
		throw new Error(`user_audit_logs: invalid source "${params.source}" (normalized: "${source}")`);
	}
	let actorId = params.actorId ?? null;
	if (actorType === 'system' && (actorId == null || actorId === '')) {
		actorId = SYSTEM_GATEWAY_ACTOR_ID;
	}
	if (actorType === 'service' && (actorId == null || actorId === '')) {
		actorId = SERVICE_USER_PROVISION_ACTOR_ID;
	}
	if (actorType === 'admin' && (actorId == null || actorId === '' || actorId === 'master_key')) {
		actorId = ADMIN_GATEWAY_MASTER_ACTOR_ID;
	}
	return {
		...params,
		source,
		actorId,
	};
}
