import type { GatewayProvider } from '@/lib/types';
import type { ProviderProtocolSummary } from './types';

export { PROVIDER_KEY_LABEL_MAX_LENGTH } from '@/lib/provider-key-label';

/** 表单三个限流输入 → limit_config JSON 字符串；全空返回 null（不限流）。 */
export function buildLimitConfigJson(form: {
	rpm: string;
	tpm: string;
	max_concurrency: string;
}): string | null {
	const out: Record<string, number> = {};
	const rpm = Number(form.rpm);
	const tpm = Number(form.tpm);
	const maxConcurrency = Number(form.max_concurrency);
	if (form.rpm.trim() !== '' && Number.isFinite(rpm) && rpm > 0) out.rpm = Math.floor(rpm);
	if (form.tpm.trim() !== '' && Number.isFinite(tpm) && tpm > 0) out.tpm = Math.floor(tpm);
	if (form.max_concurrency.trim() !== '' && Number.isFinite(maxConcurrency) && maxConcurrency > 0) {
		out.max_concurrency = Math.floor(maxConcurrency);
	}
	return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/** limit_config JSON → 表单字段（编辑既有 key 时预填）。 */
export function limitConfigToFormFields(raw: string | null): {
	rpm: string;
	tpm: string;
	max_concurrency: string;
} {
	const empty = { rpm: '', tpm: '', max_concurrency: '' };
	if (!raw) return empty;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			rpm: typeof parsed.rpm === 'number' ? String(parsed.rpm) : '',
			tpm: typeof parsed.tpm === 'number' ? String(parsed.tpm) : '',
			max_concurrency: typeof parsed.max_concurrency === 'number' ? String(parsed.max_concurrency) : '',
		};
	} catch {
		return empty;
	}
}

/** 表格「Limits」列展示文本。 */
export function formatLimitConfig(raw: string | null): string {
	const fields = limitConfigToFormFields(raw);
	const parts: string[] = [];
	if (fields.rpm) parts.push(`RPM ${fields.rpm}`);
	if (fields.tpm) parts.push(`TPM ${fields.tpm}`);
	if (fields.max_concurrency) parts.push(`Conc ${fields.max_concurrency}`);
	return parts.length > 0 ? parts.join(' · ') : '—';
}

export function getProviderProtocolSummaries(provider: GatewayProvider): ProviderProtocolSummary[] {
	const rows: ProviderProtocolSummary[] = [];
	const openaiUrl = provider.base_url_openai?.trim() ?? '';
	const anthropicUrl = provider.base_url_anthropic?.trim() ?? '';
	const geminiUrl = provider.base_url_gemini?.trim() ?? '';
	if (openaiUrl) rows.push({ key: 'openai', label: 'OpenAI', url: openaiUrl });
	if (anthropicUrl) rows.push({ key: 'anthropic', label: 'Anthropic', url: anthropicUrl });
	if (geminiUrl) rows.push({ key: 'gemini', label: 'Gemini', url: geminiUrl });
	return rows;
}

export function suggestDuplicateProviderId(sourceId: string, existingIds: Set<string>): string {
	const base = `${sourceId}-copy`;
	if (!existingIds.has(base)) return base;
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}-${n}`;
		if (!existingIds.has(candidate)) return candidate;
	}
	return '';
}

export function sortProviderKeyRows<T extends { priority: number; weight: number; label: string }>(
	rows: T[]
): T[] {
	return rows
		.slice()
		.sort((a, b) => b.priority - a.priority || b.weight - a.weight || a.label.localeCompare(b.label));
}
