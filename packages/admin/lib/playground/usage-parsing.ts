/**
 * Playground / Simulator：从 JSON 或 SSE 报文中提取 usage 摘要（展示用）。
 */
import type { PlaygroundProtocol } from '@/lib/playground/merge-assistant-text';

export function normalizeProtocol(p: string): PlaygroundProtocol {
	const v = (p || 'openai').trim().toLowerCase();
	if (v === 'anthropic' || v === 'gemini' || v === 'openai') return v;
	return 'openai';
}

export function tryParseUsageSummary(text: string, protocol: string): string | null {
	const proto = normalizeProtocol(protocol);
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		if (proto === 'gemini') {
			const um = parsed.usageMetadata as Record<string, unknown> | undefined;
			if (um && typeof um === 'object') {
				const parts: string[] = [];
				for (const k of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount']) {
					if (typeof um[k] === 'number') parts.push(`${k}: ${um[k]}`);
				}
				return parts.length ? parts.join(', ') : null;
			}
		}
		const u = parsed.usage as Record<string, unknown> | undefined;
		if (u && typeof u === 'object') {
			const pt = u.prompt_tokens ?? u.input_tokens;
			const ct = u.completion_tokens ?? u.output_tokens;
			const tt = u.total_tokens;
			const bits: string[] = [];
			if (typeof pt === 'number') bits.push(`prompt/input: ${pt}`);
			if (typeof ct === 'number') bits.push(`completion/output: ${ct}`);
			if (typeof tt === 'number') bits.push(`total: ${tt}`);
			return bits.length ? bits.join(' · ') : null;
		}
	} catch {
		// ignore
	}
	return null;
}

/** 从单条 SSE JSON 对象中尽量提取 usage 摘要（兼容嵌套与各家字段）。 */
export function extractUsageFromStreamChunk(o: Record<string, unknown>, protocol: string): string | null {
	const proto = normalizeProtocol(protocol);
	if (proto === 'gemini' && o.usageMetadata && typeof o.usageMetadata === 'object') {
		return tryParseUsageSummary(JSON.stringify({ usageMetadata: o.usageMetadata }), 'gemini');
	}
	if (o.usage && typeof o.usage === 'object') {
		return tryParseUsageSummary(JSON.stringify({ usage: o.usage }), protocol);
	}
	const msg = o.message;
	if (msg && typeof msg === 'object') {
		const mu = (msg as { usage?: unknown }).usage;
		if (mu && typeof mu === 'object') {
			return tryParseUsageSummary(JSON.stringify({ usage: mu }), protocol);
		}
	}
	const pt = o.prompt_tokens ?? o.input_tokens;
	const ct = o.completion_tokens ?? o.output_tokens;
	const tt = o.total_tokens;
	if (typeof pt === 'number' || typeof ct === 'number') {
		const usage: Record<string, number> = {};
		if (typeof pt === 'number') usage.prompt_tokens = pt;
		if (typeof ct === 'number') usage.completion_tokens = ct;
		if (typeof tt === 'number') usage.total_tokens = tt;
		else if (typeof pt === 'number' && typeof ct === 'number') usage.total_tokens = pt + ct;
		return tryParseUsageSummary(JSON.stringify({ usage }), protocol);
	}
	return null;
}

/** 从 SSE 文本中提取最后一条可解析的 usage（`data:` 允许无空格；自底向上扫描）。 */
export function parseLastStreamUsage(sseText: string, protocol: string): string | null {
	const lines = sseText.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]?.trim() ?? '';
		if (!line.toLowerCase().startsWith('data:')) {
			continue;
		}
		const data = line.slice(5).replace(/^\uFEFF/, '').trim();
		if (data === '[DONE]' || data === '') {
			continue;
		}
		try {
			const o = JSON.parse(data) as Record<string, unknown>;
			const summary = extractUsageFromStreamChunk(o, protocol);
			if (summary) {
				return summary;
			}
		} catch {
			continue;
		}
	}
	return null;
}
