/**
 * `providers.kind` → 额度适配器。空 kind 与 `__custom__` 不在表内。
 *
 * 未接入：
 * - `Kimi Code (Coding API)` 的云端用量接口没有稳定公开契约
 * - ZenMux、xAI、OpenAI、Anthropic 的余额接口要另一把管理密钥
 */
import { deepinfraQuotaAdapter } from './adapters/deepinfra';
import { deepseekQuotaAdapter } from './adapters/deepseek';
import { zaiCodingPlanQuotaAdapter, zhipuCodingPlanQuotaAdapter } from './adapters/glm-coding-plan';
import { minimaxQuotaAdapter } from './adapters/minimax';
import { moonshotQuotaAdapter } from './adapters/moonshot';
import { novitaQuotaAdapter } from './adapters/novita';
import { opencodeGoQuotaAdapter } from './adapters/opencode-go';
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
	'OpenCode Go': opencodeGoQuotaAdapter,
	MiniMax: minimaxQuotaAdapter,
	'Zhipu GLM (Coding Plan)': zhipuCodingPlanQuotaAdapter,
	'Z.AI GLM (Coding Plan)': zaiCodingPlanQuotaAdapter,
};

export function getProviderQuotaAdapter(kind: string | null | undefined): ProviderQuotaAdapter | null {
	const key = String(kind ?? '').trim();
	if (!key) return null;
	return PROVIDER_QUOTA_ADAPTER_BY_KIND[key] ?? null;
}

export function listProviderQuotaKinds(): string[] {
	return Object.keys(PROVIDER_QUOTA_ADAPTER_BY_KIND);
}
