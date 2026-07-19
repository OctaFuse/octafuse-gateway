/**
 * 管理端内置 model 静态目录：用于一键导入 `models` 表。
 *
 * 仅维护**有自研/自有模型**的厂商，见 `model-presets/<vendor-key>.json`。
 * 聚合平台（OpenRouter、SiliconFlow、Groq、Together、Ollama 等）与云托管面（AWS Bedrock、Azure、火山方舟接入层等）
 * 不在此目录占位；其 `vendor` 仍可在 `model-vendors.json` 中用于下拉与归一化。
 *
 * 命名约定：
 * - `<vendor>.json` — LLM（`modalities.output` 以 `text` 为主，含多模态「看图」LLM）
 * - `<vendor>-image.json` — 纯文生图（`modalities.output` 含 `image`）
 *
 * 各预设内 **`pricing.usd`** 与 D1 导出 `data/remote/.../data-remote-table-models-*.sql` 中 `pricing_profile` 一致（美元口径）；
 * **`pricing.cny`** 以中国区 Postgres 导出为准（无 CN 价的模型仍为 USD 换算占位）。
 * 导入时按当前 `BILLING_CURRENCY` 选用 `usd` / `cny` 之一写入 `pricing_profile`。
 *
 * 合并顺序：与下方 import 列表一致（尚未录入价目的厂商保留 `[]` 占位文件；image 文件紧挨同 vendor 的 LLM 之后）。
 */
import aliyunPresets from './model-presets/aliyun.json';
import anthropicPresets from './model-presets/anthropic.json';
import baichuanPresets from './model-presets/baichuan.json';
import baiduPresets from './model-presets/baidu.json';
import bytedancePresets from './model-presets/bytedance.json';
import bytedanceImagePresets from './model-presets/bytedance-image.json';
import coherePresets from './model-presets/cohere.json';
import deepseekPresets from './model-presets/deepseek.json';
import googlePresets from './model-presets/google.json';
import googleImagePresets from './model-presets/google-image.json';
import meituanPresets from './model-presets/meituan.json';
import metaPresets from './model-presets/meta.json';
import minimaxPresets from './model-presets/minimax.json';
import mistralPresets from './model-presets/mistral.json';
import moonshotPresets from './model-presets/moonshot.json';
import openaiPresets from './model-presets/openai.json';
import openaiImagePresets from './model-presets/openai-image.json';
import perplexityPresets from './model-presets/perplexity.json';
import stabilityPresets from './model-presets/stability.json';
import stepfunPresets from './model-presets/stepfun.json';
import tencentPresets from './model-presets/tencent.json';
import xaiPresets from './model-presets/xai.json';
import xaiImagePresets from './model-presets/xai-image.json';
import xiaomiPresets from './model-presets/xiaomi.json';
import zhipuPresets from './model-presets/zhipu.json';
import zhipuImagePresets from './model-presets/zhipu-image.json';
import type { GatewaySupportedBillingCurrency } from '@octafuse/core/lib/billing-currency';

export type StaticModelPresetModalities = {
	input: string[];
	output: string[];
};

export type StaticModelPresetRow = {
	id: string;
	display_name?: string | null;
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	/** Gateway `model_tags` (e.g. `New`, `Hot`, `Discount:0.3` for VIP/default, `Discount.free:0.5` for free route). */
	tags?: string[];
	/** OpenRouter-style input/output modalities. */
	modalities?: StaticModelPresetModalities;
	/** Model release date `YYYY-MM-DD`. */
	released?: string | null;
	pricing: {
		usd: unknown;
		cny: unknown;
	};
};

const STATIC_MODEL_PRESETS_BY_VENDOR = [
	aliyunPresets,
	anthropicPresets,
	baichuanPresets,
	baiduPresets,
	bytedancePresets,
	bytedanceImagePresets,
	coherePresets,
	deepseekPresets,
	googlePresets,
	googleImagePresets,
	meituanPresets,
	metaPresets,
	minimaxPresets,
	mistralPresets,
	moonshotPresets,
	openaiPresets,
	openaiImagePresets,
	perplexityPresets,
	stabilityPresets,
	stepfunPresets,
	tencentPresets,
	xaiPresets,
	xaiImagePresets,
	xiaomiPresets,
	zhipuPresets,
	zhipuImagePresets,
] as const;

export function listStaticModelPresets(): StaticModelPresetRow[] {
	return STATIC_MODEL_PRESETS_BY_VENDOR.flat() as StaticModelPresetRow[];
}

export function pickPresetPricingRawForBillingCurrency(
	preset: StaticModelPresetRow,
	billing: GatewaySupportedBillingCurrency
): unknown {
	return billing === 'CNY' ? preset.pricing.cny : preset.pricing.usd;
}
