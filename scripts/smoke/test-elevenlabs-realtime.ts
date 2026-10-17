/**
 * 手动 ElevenLabs WebSocket 冒烟：直连已启动的 Node / Workers Proxy，不进 CI。
 * 需要真实 ElevenLabs Key，以及已配置的路由：
 * - TTS：`audio.speech.realtime`（目录模型如 elevenlabs-flash-v2.5）
 * - STT：`audio.transcriptions.realtime`（如 elevenlabs-scribe-v2-realtime），STT 还需 16kHz/16bit/单声道裸 PCM
 *
 * 环境变量：
 * - GATEWAY_BASE_URL — Proxy 根 URL，默认 http://127.0.0.1:8787
 * - GATEWAY_API_KEY — 用户 sk；未设置则跳过（exit 0）
 * - GATEWAY_ELEVENLABS_TTS_MODEL — 默认 elevenlabs-flash-v2.5
 * - GATEWAY_ELEVENLABS_VOICE_ID — TTS 的 voice_id，必填；未设置则跳过 TTS
 * - GATEWAY_ELEVENLABS_STT_MODEL — 默认 elevenlabs-scribe-v2-realtime
 * - GATEWAY_REALTIME_PCM — STT 用裸 PCM 路径；未设置则跳过 STT
 * - GATEWAY_MASTER_URL / GATEWAY_MASTER_KEY — 可选；用于核对请求日志落库
 * - GATEWAY_SMOKE_SKIP_REALTIME=1 — 强制跳过
 *
 * 路径与官方一致：`/elevenlabs/v1/text-to-speech/{voice_id}/stream-input?model_id=`、
 * `/elevenlabs/v1/speech-to-text/realtime?model_id=`；鉴权用官方 SDK 同款 `xi-api-key` 头，
 * 值填网关 sk（上游 ElevenLabs Key 由网关路由选择）。
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
const TTS_MODEL = process.env.GATEWAY_ELEVENLABS_TTS_MODEL?.trim() || 'elevenlabs-flash-v2.5';
const VOICE_ID = process.env.GATEWAY_ELEVENLABS_VOICE_ID?.trim() ?? '';
const STT_MODEL = process.env.GATEWAY_ELEVENLABS_STT_MODEL?.trim() || 'elevenlabs-scribe-v2-realtime';
const PCM_PATH = process.env.GATEWAY_REALTIME_PCM?.trim() ?? '';
const CHUNK_BYTES = 3200;
const CHUNK_INTERVAL_MS = 100;

function wsUrl(path: string, query: Record<string, string>): string {
	const url = new URL(GATEWAY_BASE_URL);
	url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
	url.pathname = path;
	url.search = new URLSearchParams(query).toString();
	return url.toString();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(raw: unknown): Record<string, unknown> | null {
	const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : '';
	try {
		const value = JSON.parse(text) as unknown;
		return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

async function maybeAssertRequestLog(model: string, billingKind: string): Promise<void> {
	const masterUrl = (process.env.GATEWAY_MASTER_URL ?? '').replace(/\/$/, '');
	const masterKey = process.env.GATEWAY_MASTER_KEY?.trim() || process.env.MASTER_KEY?.trim();
	if (!masterUrl || !masterKey) {
		console.log('[elevenlabs-realtime-smoke] skip request-log check (no GATEWAY_MASTER_URL / KEY)');
		return;
	}
	await sleep(2500);
	const res = await fetch(
		`${masterUrl}/api/admin/request-logs?page=1&page_size=5&model_id=${encodeURIComponent(model)}&status=success`,
		{ headers: { Authorization: `Bearer ${masterKey}` } }
	);
	if (!res.ok) {
		console.warn(`[elevenlabs-realtime-smoke] request-log lookup HTTP ${res.status}; skip assertion`);
		return;
	}
	const body = (await res.json()) as { data?: Array<Record<string, unknown>> };
	const hit = (body.data ?? []).find((row) => row.billing_kind === billingKind);
	if (!hit) throw new Error(`No successful ${billingKind} request log for ${model}`);
	console.log(
		`[elevenlabs-realtime-smoke] request log ok model=${model} status=${hit.status} charged=${hit.charged_cost}`
	);
}

async function runTts(): Promise<void> {
	const url = wsUrl(`/elevenlabs/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}/stream-input`, {
		model_id: TTS_MODEL,
		output_format: 'pcm_16000',
	});
	console.log(`[elevenlabs-realtime-smoke] TTS connect ${url}`);
	const ws = new WebSocket(url, { headers: { 'xi-api-key': GATEWAY_API_KEY } });
	let audioFrames = 0;
	let audioBytes = 0;

	const done = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for TTS isFinal')), 60_000);
		ws.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		ws.on('message', (raw) => {
			const msg = parseJson(raw);
			if (!msg) return;
			if (typeof msg.audio === 'string' && msg.audio) {
				audioFrames += 1;
				audioBytes += Buffer.from(msg.audio, 'base64').length;
			}
			if (typeof msg.error === 'string') {
				clearTimeout(timer);
				reject(new Error(`TTS error frame: ${JSON.stringify(msg).slice(0, 300)}`));
			}
			if (msg.isFinal === true) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		ws.once('open', () => resolve());
		ws.once('error', reject);
	});
	ws.send(JSON.stringify({ text: ' ' }));
	ws.send(JSON.stringify({ text: 'Hello from the OctaFuse gateway. ' }));
	ws.send(JSON.stringify({ text: '' }));
	await done;
	ws.close(1000, 'done');

	if (audioFrames === 0 || audioBytes === 0) throw new Error('TTS returned no audio');
	console.log(`[elevenlabs-realtime-smoke] TTS ok frames=${audioFrames} bytes=${audioBytes}`);
	await maybeAssertRequestLog(TTS_MODEL, 'audio_per_character');
}

async function runStt(): Promise<void> {
	const pcm = readFileSync(PCM_PATH);
	if (pcm.length < CHUNK_BYTES) throw new Error(`PCM file too small: ${PCM_PATH}`);
	const url = wsUrl('/elevenlabs/v1/speech-to-text/realtime', {
		model_id: STT_MODEL,
		audio_format: 'pcm_16000',
		commit_strategy: 'manual',
	});
	console.log(`[elevenlabs-realtime-smoke] STT connect ${url} pcm=${pcm.length}B`);
	const ws = new WebSocket(url, { headers: { 'xi-api-key': GATEWAY_API_KEY } });
	let committed = '';

	const done = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timed out waiting for committed transcript')), 90_000);
		ws.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		ws.on('message', (raw) => {
			const msg = parseJson(raw);
			if (!msg) return;
			const type = String(msg.message_type ?? '');
			if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
				committed += String(msg.text ?? '');
				clearTimeout(timer);
				resolve();
			} else if (type.endsWith('_error') || type === 'error' || type === 'quota_exceeded') {
				clearTimeout(timer);
				reject(new Error(`STT error event: ${JSON.stringify(msg).slice(0, 300)}`));
			}
		});
	});
	await new Promise<void>((resolve, reject) => {
		ws.once('open', () => resolve());
		ws.once('error', reject);
	});

	for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
		if (ws.readyState !== WebSocket.OPEN) break;
		const chunk = pcm.subarray(offset, Math.min(offset + CHUNK_BYTES, pcm.length));
		ws.send(
			JSON.stringify({
				message_type: 'input_audio_chunk',
				audio_base_64: chunk.toString('base64'),
				sample_rate: 16000,
			})
		);
		await sleep(CHUNK_INTERVAL_MS);
	}
	ws.send(
		JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', sample_rate: 16000, commit: true })
	);
	await done;
	// 故意不带状态码关闭，回归 Node 运行时对 1005 的处理与记账。
	ws.close();

	if (!committed.trim()) throw new Error('STT returned empty text');
	console.log(`[elevenlabs-realtime-smoke] STT text=${JSON.stringify(committed)}`);
	await maybeAssertRequestLog(STT_MODEL, 'audio_per_second');
}

async function main(): Promise<void> {
	if (SKIP || !GATEWAY_API_KEY || (!VOICE_ID && !PCM_PATH)) {
		console.log(
			'[elevenlabs-realtime-smoke] skipped (need GATEWAY_API_KEY plus GATEWAY_ELEVENLABS_VOICE_ID and/or GATEWAY_REALTIME_PCM)'
		);
		return;
	}
	if (VOICE_ID) await runTts();
	else console.log('[elevenlabs-realtime-smoke] skip TTS (no GATEWAY_ELEVENLABS_VOICE_ID)');
	if (PCM_PATH) await runStt();
	else console.log('[elevenlabs-realtime-smoke] skip STT (no GATEWAY_REALTIME_PCM)');
}

main().catch((error) => {
	console.error('[elevenlabs-realtime-smoke]', error instanceof Error ? error.message : error);
	process.exit(1);
});
