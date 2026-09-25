/**
 * `providers.kind` → 额度适配器。空 kind 与 `__custom__` 不在表内。
 *
 * 未接入：
 * - `Zhipu GLM (Coding Plan)` / `Z.AI GLM (Coding Plan)`、`Kimi Code (Coding API)`：没有稳定公开契约
 * - MiniMax Token Plan 的 `GET /v1/token_plan/remains` 官方只给了请求，没有响应字段
 * - ZenMux、xAI、OpenAI、Anthropic 的余额接口要另一把管理密钥
 */
import { deepinfraQuotaAdapter } from './adapters/deepinfra';
import { deepseekQuotaAdapter } from './adapters/deepseek';
import { moonshotQuotaAdapter } from './adapters/moonshot';
import { novitaQuotaAdapter } from './adapters/novita';
import { openrouterQuotaAdapter } from './adapters/openrouter';
import { siliconflowInternationalQuotaAdapter, siliconflowQuotaAdapter } from './adapters/siliconflow';
import { stepfunQuotaAdapter } from './adapters/stepfun';
import { vercelQuotaAdapter } from './adapters/vercel';
import type { ProviderQuotaAdapter } from './types';

export const PROVIDER_QUOTA_ADAPTER_BY_KIND: Readonly<Record<string, ProviderQuotaAdapter>> = {
	DeepSeek: deepseekQuotaAdapter,
	'Moonshot AI': moonshotQuotaAdapter,
	SiliconFlow: siliconflowQuotaAdapter,
	'SiliconFlow (International)': siliconflowInternationalQuotaAdapter,
	OpenRouter: openrouterQuotaAdapter,
	'Novita AI': novitaQuotaAdapter,
	DeepInfra: deepinfraQuotaAdapter,
	StepFun: stepfunQuotaAdapter,
	'Vercel AI Gateway': vercelQuotaAdapter,
};

export function getProviderQuotaAdapter(kind: string | null | undefined): ProviderQuotaAdapter | null {
	const key = String(kind ?? '').trim();
	if (!key) return null;
	return PROVIDER_QUOTA_ADAPTER_BY_KIND[key] ?? null;
}

export function listProviderQuotaKinds(): string[] {
	return Object.keys(PROVIDER_QUOTA_ADAPTER_BY_KIND);
}
