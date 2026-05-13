/**
 * 读取 Cloudflare / OpenNext 运行时绑定（`DB`、`ASSETS`、`ADMIN_*` 等）。
 * 按优先级尝试：`getCloudflareContext` → `request.ctx` → `globalThis` → `process.env`，兼容 `next dev` 与 Pages 预览。
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getCloudflareContext } from '@opennextjs/cloudflare';

interface RequestWithCloudflare extends Request {
	ctx?: {
		cloudflare?: {
			env?: CloudflareEnv;
		};
	};
	env?: CloudflareEnv;
}

interface GlobalWithCloudflare {
	ASSETS?: CloudflareEnv['ASSETS'];
	DB?: D1Database;
	ADMIN_USERNAME?: string;
	ADMIN_PASSWORD?: string;
}

interface ProcessWithEnv {
	env?: CloudflareEnv & Record<string, unknown>;
}

export function getCloudflareEnv(request?: Request): CloudflareEnv | undefined {
	try {
		const cloudflareContext = getCloudflareContext();
		if (cloudflareContext?.env) {
			return cloudflareContext.env as CloudflareEnv;
		}
	} catch {
		// 本地 next dev 等场景下常不可用
	}

	if (request) {
		const requestWithCf = request as RequestWithCloudflare;
		if (requestWithCf.ctx?.cloudflare?.env) {
			return requestWithCf.ctx.cloudflare.env;
		}

		if (requestWithCf.env) {
			return requestWithCf.env;
		}
	}

	if (typeof globalThis !== 'undefined') {
		const globalEnv = globalThis as unknown as GlobalWithCloudflare;
		if (globalEnv.ASSETS || globalEnv.DB) {
			return {
				ASSETS: globalEnv.ASSETS,
				DB: globalEnv.DB,
				ADMIN_USERNAME: globalEnv.ADMIN_USERNAME as string,
				ADMIN_PASSWORD: globalEnv.ADMIN_PASSWORD as string,
			} as CloudflareEnv;
		}
	}

	if (typeof process !== 'undefined') {
		const proc = process as unknown as ProcessWithEnv;
		if (proc.env?.ADMIN_USERNAME || proc.env?.ADMIN_PASSWORD) {
			return proc.env as CloudflareEnv;
		}
	}

	return undefined;
}
