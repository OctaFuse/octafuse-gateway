import type { GatewayProvider } from '@/lib/types';
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
	type ProtocolEndpointsConfig,
} from '@octafuse/core/provider-endpoints';
import type {
	ProtocolEndpointForm,
	ProviderCapabilityBadge,
	ProviderFormData,
	ProviderProtocolSummary,
} from './types';
import { EMPTY_PROTOCOL_FORM } from './types';

/** 完整 capability → 卡片紧凑标签（OpenAI images.* 合并为 images）。 */
export function capabilityDisplayBadges(
	capabilities: readonly ProviderEndpointCapability[]
): ProviderCapabilityBadge[] {
	const badges: ProviderCapabilityBadge[] = [];
	const set = new Set(capabilities);
	if (set.has('chat')) badges.push('chat');
	if (set.has('images.generations') || set.has('images.edits')) badges.push('images');
	if (set.has('messages')) badges.push('messages');
	if (set.has('generateContent')) badges.push('generateContent');
	if (set.has('streamGenerateContent')) badges.push('streamGenerateContent');
	return badges;
}

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

function protocolFormFromConfig(cfg: ProtocolEndpointsConfig | undefined): ProtocolEndpointForm {
	const form: ProtocolEndpointForm = { ...EMPTY_PROTOCOL_FORM };
	if (!cfg) return form;
	form.base = cfg.base ?? '';
	const eps = cfg.endpoints ?? {};
	form.chat = eps.chat ?? '';
	form.images_generations = eps['images.generations'] ?? '';
	form.images_edits = eps['images.edits'] ?? '';
	form.messages = eps.messages ?? '';
	form.generateContent = eps.generateContent ?? '';
	form.streamGenerateContent = eps.streamGenerateContent ?? '';
	return form;
}

/** Provider 行 → 弹窗表单（`endpoints` 列）。 */
export function providerToFormData(provider: GatewayProvider): Omit<ProviderFormData, 'id' | 'name' | 'description'> & {
	openai: ProtocolEndpointForm;
	anthropic: ProtocolEndpointForm;
	gemini: ProtocolEndpointForm;
} {
	const map = parseProviderEndpoints(provider);
	return {
		openai: protocolFormFromConfig(map.openai),
		anthropic: protocolFormFromConfig(map.anthropic),
		gemini: protocolFormFromConfig(map.gemini),
	};
}

function configFromProtocolForm(
	protocol: 'openai' | 'anthropic' | 'gemini',
	form: ProtocolEndpointForm
): ProtocolEndpointsConfig | undefined {
	const base = form.base.trim();
	const endpoints: NonNullable<ProtocolEndpointsConfig['endpoints']> = {};
	if (protocol === 'openai') {
		if (form.chat.trim()) endpoints.chat = form.chat.trim();
		if (form.images_generations.trim()) endpoints['images.generations'] = form.images_generations.trim();
		if (form.images_edits.trim()) endpoints['images.edits'] = form.images_edits.trim();
	} else if (protocol === 'anthropic') {
		if (form.messages.trim()) endpoints.messages = form.messages.trim();
	} else {
		if (form.generateContent.trim()) endpoints.generateContent = form.generateContent.trim();
		if (form.streamGenerateContent.trim()) {
			endpoints.streamGenerateContent = form.streamGenerateContent.trim();
		}
	}
	if (!base && Object.keys(endpoints).length === 0) return undefined;
	const cfg: ProtocolEndpointsConfig = {};
	if (base) cfg.base = base;
	if (Object.keys(endpoints).length > 0) cfg.endpoints = endpoints;
	return cfg;
}

/** 表单 → API `endpoints` 对象。 */
export function formDataToEndpointsMap(form: ProviderFormData): ProviderEndpointsMap {
	const map: ProviderEndpointsMap = {};
	const openai = configFromProtocolForm('openai', form.openai);
	const anthropic = configFromProtocolForm('anthropic', form.anthropic);
	const gemini = configFromProtocolForm('gemini', form.gemini);
	if (openai) map.openai = openai;
	if (anthropic) map.anthropic = anthropic;
	if (gemini) map.gemini = gemini;
	return map;
}

export function formDataToEndpointsJson(form: ProviderFormData): string | null {
	return serializeProviderEndpoints(formDataToEndpointsMap(form));
}

export function getProviderProtocolSummaries(provider: GatewayProvider): ProviderProtocolSummary[] {
	const map = parseProviderEndpoints(provider);
	const rows: ProviderProtocolSummary[] = [];
	if (map.openai) {
		const url = map.openai.base || map.openai.endpoints?.chat || Object.values(map.openai.endpoints ?? {})[0] || '';
		if (url) {
			const capabilities = listConfiguredCapabilities(map, 'openai');
			rows.push({
				key: 'openai',
				label: 'OpenAI',
				url,
				capabilities,
				badges: capabilityDisplayBadges(capabilities),
			});
		}
	}
	if (map.anthropic) {
		const url =
			map.anthropic.base ||
			map.anthropic.endpoints?.messages ||
			Object.values(map.anthropic.endpoints ?? {})[0] ||
			'';
		if (url) {
			const capabilities = listConfiguredCapabilities(map, 'anthropic');
			rows.push({
				key: 'anthropic',
				label: 'Anthropic',
				url,
				capabilities,
				badges: capabilityDisplayBadges(capabilities),
			});
		}
	}
	if (map.gemini) {
		const url =
			map.gemini.base ||
			map.gemini.endpoints?.generateContent ||
			Object.values(map.gemini.endpoints ?? {})[0] ||
			'';
		if (url) {
			const capabilities = listConfiguredCapabilities(map, 'gemini');
			rows.push({
				key: 'gemini',
				label: 'Gemini',
				url,
				capabilities,
				badges: capabilityDisplayBadges(capabilities),
			});
		}
	}
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

/** 某协议 Advanced 区是否有任意覆盖（用于默认展开）。 */
export function protocolFormHasOverrides(
	protocol: 'openai' | 'anthropic' | 'gemini',
	form: ProtocolEndpointForm
): boolean {
	if (protocol === 'openai') {
		return !!(form.chat.trim() || form.images_generations.trim() || form.images_edits.trim());
	}
	if (protocol === 'anthropic') return !!form.messages.trim();
	return !!(form.generateContent.trim() || form.streamGenerateContent.trim());
}
