/**
 * 维护模式管理：读写 `system_config.MAINTENANCE_MODE`，并提供 Admin 写接口守卫的判定。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	MAINTENANCE_MODE_KEY,
	buildMaintenanceConfigFromInput,
	getMaintenanceConfig,
	invalidateMaintenanceModeCache,
	maintenanceRemainingMinutes,
	maintenanceRetryAfterSeconds,
	parseMaintenanceConfig,
	resolveMaintenanceMessage,
	serializeMaintenanceConfig,
	MAINTENANCE_MODE_CACHE_TTL_MS,
	type MaintenanceConfig,
	type MaintenanceConfigInput,
} from '@octafuse/core/lib/maintenance-mode';
import { badRequest } from './errors';

export interface MaintenanceStatus {
	config: MaintenanceConfig;
	/** 以默认语言（无 Accept-Language）解析后的提示，供后台预览；中文优先。 */
	effective_message: string | null;
	/** 距预计结束的分钟数；未设置或已过期为 null。 */
	remaining_minutes: number | null;
	retry_after_seconds: number | null;
	/** 各 Proxy 节点最迟多久后一定生效（进程内缓存 TTL）。 */
	propagation_seconds: number;
}

function toStatus(config: MaintenanceConfig, now: Date = new Date()): MaintenanceStatus {
	return {
		config,
		effective_message: config.enabled ? resolveMaintenanceMessage(config, 'zh', now) : null,
		remaining_minutes: config.enabled ? maintenanceRemainingMinutes(config, now) : null,
		retry_after_seconds: config.enabled ? maintenanceRetryAfterSeconds(config, now) : null,
		propagation_seconds: Math.ceil(MAINTENANCE_MODE_CACHE_TTL_MS / 1000),
	};
}

/** 直接读库，不走缓存：后台展示要看到真实当前值。 */
export async function getMaintenanceStatusService(repos: GatewayRepositories): Promise<MaintenanceStatus> {
	const raw = await repos.systemConfig.getConfig(MAINTENANCE_MODE_KEY);
	return toStatus(parseMaintenanceConfig(raw));
}

export async function setMaintenanceService(
	repos: GatewayRepositories,
	body: MaintenanceConfigInput
): Promise<MaintenanceStatus> {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw badRequest('Request body must be a JSON object');
	}
	let config: MaintenanceConfig;
	try {
		config = buildMaintenanceConfigFromInput(body);
	} catch (error) {
		throw badRequest(error instanceof Error ? error.message : 'Invalid maintenance config');
	}
	await repos.systemConfig.upsertSystemConfigValue(MAINTENANCE_MODE_KEY, serializeMaintenanceConfig(config));
	invalidateMaintenanceModeCache();
	return toStatus(config);
}

/** 这些路径在 Admin 写入冻结期间仍可写：解除维护、签发迁移用密钥、调试台。 */
export function isAdminWriteFreezeExempt(path: string): boolean {
	return (
		path === '/admin/maintenance' ||
		path.startsWith('/admin/maintenance/') ||
		path.startsWith('/admin/access-keys') ||
		path.startsWith('/admin/playground')
	);
}

/**
 * 写冻结判定：维护开启且 `block_admin_writes`，请求是非只读方法且不在豁免名单。
 * 读配置失败时 fail-open（返回 null），避免配置故障让后台整体不可写。
 */
export async function getAdminWriteFreeze(
	repos: GatewayRepositories,
	method: string,
	path: string
): Promise<{ message: string; retryAfterSeconds: number } | null> {
	const upper = method.toUpperCase();
	if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return null;
	if (isAdminWriteFreezeExempt(path)) return null;
	let config: MaintenanceConfig;
	try {
		config = await getMaintenanceConfig(repos);
	} catch (error) {
		console.warn('[admin] failed to read MAINTENANCE_MODE, writes stay enabled', error);
		return null;
	}
	if (!config.enabled || !config.block_admin_writes) return null;
	return {
		message: resolveMaintenanceMessage(config, 'zh'),
		retryAfterSeconds: maintenanceRetryAfterSeconds(config),
	};
}
