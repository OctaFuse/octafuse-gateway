/** 从 `system_config` 读取 `MASTER_KEY`，供管理员 Bearer 校验与中间件比对。 */
import type { GatewayRepositories } from '@octafuse/core';

/**
 * 读取 `system_config.MASTER_KEY`；未配置返回 null（中间件需另行处理）。
 */
export async function getMasterKey(repos: GatewayRepositories): Promise<string | null> {
	return repos.systemConfig.getConfig('MASTER_KEY');
}
