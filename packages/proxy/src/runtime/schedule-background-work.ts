import type { Context } from 'hono';

/**
 * Cloudflare Workers：用 `ExecutionContext.waitUntil` 延长请求生命周期以跑异步记账等。
 * Node（Docker / `@hono/node-server`）：无 ExecutionContext，访问 `c.executionCtx` 会抛错；
 * 降级为 detached Promise，避免阻塞主响应。
 */
export function scheduleBackgroundWork(c: Context, task: Promise<unknown>): void {
	try {
		c.executionCtx.waitUntil(task);
	} catch {
		void task.catch((err) => {
			console.error(
				'[Gateway Proxy] background task rejected (Node runtime, no ExecutionContext)',
				err instanceof Error ? err.message : String(err)
			);
		});
	}
}
