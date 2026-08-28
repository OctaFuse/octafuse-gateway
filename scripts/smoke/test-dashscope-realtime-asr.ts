/**
 * 手动 realtime ASR 冒烟：直连已启动的 Node / Workers Proxy。
 * 需要真实供应商 Key、已配置的流式 ASR 路由，以及 16kHz/16bit/单声道裸 PCM。
 *
 * 环境变量：
 * - GATEWAY_BASE_URL — Proxy 根 URL，默认 http://127.0.0.1:8787
 * - GATEWAY_API_KEY — 用户 sk；未设置则跳过（exit 0）
 * - GATEWAY_REALTIME_MODEL — 默认 qwen-audio-3.0-asr-flash-streaming
 * - GATEWAY_REALTIME_PCM — 必填裸 PCM 路径；未设置则跳过
 * - GATEWAY_MASTER_URL / GATEWAY_MASTER_KEY — 可选；用于核对请求日志落库
 * - GATEWAY_SMOKE_SKIP_REALTIME=1 — 强制跳过
 *
 * 关闭时故意调用 ws.close() 不带状态码（对端会看到 1005），用于回归 Node
 * 运行时的 close-code / 计费记账修复。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'));
const { WebSocket } = require('ws') as typeof import('ws');

const SKIP = ['1', 'true', 'yes'].includes(
	(process.env.GATEWAY_SMOKE_SKIP_REALTIME ?? '').toLowerCase()
);
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY?.trim() ?? '';
const MODEL = process.env.GATEWAY_REALTIME_MODEL?.trim() || 'qwen-audio-3.0-asr-flash-streaming';
const PCM_PATH = process.env.GATEWAY_REALTIME_PCM?.trim() ?? '';
const OPERATION = 'audio.transcriptions.realtime.inference';
const CHUNK_BYTES = 3200;
const CHUNK_INTERVAL_MS = 100;

function wsUrl(httpBase: string): string {
	const url = new URL(httpBase);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = '/v1/dashscope/realtime';
	url.search = `?model=${encodeURIComponent(MODEL)}&operation=${encodeURIComponent(OPERATION)}`;
	return url.toString();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type DashScopeEvent = {
	header?: { event?: string };
	payload?: {
		output?: { sentence?: { text?: string; sentence_end?: boolean } };
		usage?: unknown;
	};
};

async function maybeAssertRequestLog(): Promise<void> {
	const masterUrl = (process.env.GATEWAY_MASTER_URL ?? '').replace(/\/$/, '');
	const masterKey = process.env.GATEWAY_MASTER_KEY?.trim() || process.env.MASTER_KEY?.trim();
	if (!masterUrl || !masterKey) {
		console.log('[realtime-asr-smoke] skip request-log check (no GATEWAY_MASTER_URL / KEY)');
		return;
	}
	await sleep(2500);
	const res = await fetch(
		`${masterUrl}/api/admin/request-logs?page=1&page_size=5&model_id=${encodeURIComponent(MODEL)}&status=success`,
		{ headers: { Authorization: `Bearer ${masterKey}` } }
	);
	if (!res.ok) {
		console.warn(`[realtime-asr-smoke] request-log lookup HTTP ${res.status}; skip assertion`);
		return;
	}
	const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
	const hit = (body.data ?? []).find((row) => row.billing_kind === 'audio_per_second');
	if (!hit) {
		throw new Error('No successful audio_per_second request log after close-without-code');
	}
	console.log(
		`[realtime-asr-smoke] request log ok status=${hit.status} charged=${hit.charged_cost}`
	);
}

async function main(): Promise<void> {
	if (SKIP || !GATEWAY_API_KEY || !PCM_PATH) {
		console.log('[realtime-asr-smoke] skipped (need GATEWAY_API_KEY + GATEWAY_REALTIME_PCM)');
		return;
	}

	const pcm = readFileSync(PCM_PATH);
	if (pcm.length < CHUNK_BYTES) {
		throw new Error(`PCM file too small: ${PCM_PATH}`);
	}

	const taskId = crypto.randomUUID().replace(/-/g, '');
	const url = wsUrl(GATEWAY_BASE_URL);
	console.log(`[realtime-asr-smoke] connect ${url} pcm=${pcm.length}B`);

	const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${GATEWAY_API_KEY}` } });
	ws.binaryType = 'arraybuffer';

	let started = false;
	let finished = false;
	let finalText = '';
	let currentSentence = '';

	const opened = new Promise<void>((resolve, reject) => {
		ws.once('open', () => resolve());
		ws.once('error', (error) => reject(error));
	});
	const taskStarted = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for task-started')), 15_000);
		const onMessage = (raw: WebSocket.RawData, isBinary: boolean) => {
			if (isBinary || typeof raw !== 'string' && !Buffer.isBuffer(raw)) return;
			const text = typeof raw === 'string' ? raw : raw.toString();
			let msg: DashScopeEvent;
			try {
				msg = JSON.parse(text);
			} catch {
				return;
			}
			if (msg.header?.event === 'task-started') {
				clearTimeout(timer);
				ws.off('message', onMessage);
				resolve();
			}
		};
		ws.on('message', onMessage);
	});
	const taskFinished = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for task-finished')), 90_000);
		ws.on('message', (raw, isBinary) => {
			if (isBinary) return;
			const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : '';
			let msg: DashScopeEvent;
			try {
				msg = JSON.parse(text);
			} catch {
				return;
			}
			const name = msg.header?.event;
			if (name === 'task-started') started = true;
			if (name === 'result-generated') {
				const sentence = msg.payload?.output?.sentence;
				if (!sentence) return;
				currentSentence = String(sentence.text ?? '');
				if (sentence.sentence_end) {
					finalText += currentSentence;
					currentSentence = '';
				}
			}
			if (name === 'task-failed') {
				clearTimeout(timer);
				reject(new Error(`task-failed: ${text.slice(0, 300)}`));
			}
			if (name === 'task-finished') {
				finished = true;
				if (currentSentence) finalText += currentSentence;
				clearTimeout(timer);
				resolve();
			}
		});
	});

	await opened;
	ws.send(JSON.stringify({
		header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
		payload: {
			task_group: 'audio',
			task: 'asr',
			function: 'recognition',
			model: '<auto>',
			parameters: { format: 'pcm', sample_rate: 16000 },
			input: {},
		},
	}));
	await taskStarted;
	started = true;

	for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
		if (ws.readyState !== WebSocket.OPEN) break;
		ws.send(pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length)));
		await sleep(CHUNK_INTERVAL_MS);
	}
	ws.send(JSON.stringify({
		header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
		payload: { input: {} },
	}));
	await taskFinished;
	ws.close();

	if (!started || !finished || !finalText.trim()) {
		throw new Error('recognition returned empty text');
	}
	console.log(`[realtime-asr-smoke] text=${JSON.stringify(finalText)}`);
	await maybeAssertRequestLog();
}

main().catch((error) => {
	console.error('[realtime-asr-smoke]', error instanceof Error ? error.message : error);
	process.exit(1);
});
