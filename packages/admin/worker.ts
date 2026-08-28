/**
 * Cloudflare Worker 外层入口：实时调试 WS 必须绕过 OpenNext Server Function，
 * 其余请求继续交给 OpenNext 生成的 Next Worker。
 */
import nextWorker from './.open-next/worker.js';
import { handleAdminRealtimeUpgrade } from './lib/admin-realtime-worker';
import { PLAYGROUND_REALTIME_PATH } from './lib/playground-realtime-path';

export default {
	async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (
			request.method === 'GET' &&
			url.pathname === PLAYGROUND_REALTIME_PATH &&
			request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
		) {
			return handleAdminRealtimeUpgrade(request, env, ctx);
		}
		return nextWorker.fetch(request, env, ctx);
	},
};
