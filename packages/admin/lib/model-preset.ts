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
 * - `<vendor>-audio.json` — 语音转写 ASR（`pricing.audio_billing_mode: per_second | token`）
 * - `aliyun.json` 另含 DashScope ASR/TTS，便于从同一个官方厂商目录一起导入供应商与音频模型。
 *
 * 各预设内 **`pricing.usd`** 与 D1 导出 `data/remote/.../data-remote-table-models-*.sql` 中 `pricing_profile` 一致（美元口径）；
 * **`pricing.cny`**：国内厂商以中国区官方/Postgres 价为准；海外厂商（openai / anthropic / google / xai 等）按 **USD × 7** 换算占位。
 * 导入时按当前 `BILLING_CURRENCY` 选用 `usd` / `cny` **整段**写入 `pricing_profile`（含可选 `schedule` 官方时段，不只 `tiers`）。
 * DeepSeek V4 目录价为空闲价；`schedule` 为北京时间工作日高峰 09:00–12:00、14:00–18:00、`factor` 2。命中按 `BUSINESS_TIMEZONE` 墙钟，中国区请设 `Asia/Shanghai`。
 * 面向 Catalog 的英文摘要与中英文展示文案均与模型预设共同维护：
 * `description` 写入现有 `models.description`，`i18n` 仅供静态 Catalog 展示，不增加数据库字段。
 *
 * 合并顺序：与下方 import 列表一致（尚未录入价目的厂商保留 `[]` 占位文件；image 文件紧挨同 vendor 的 LLM 之后）。
 */
import aliyunPresets from './model-presets/aliyun.json';
import aliyunImagePresets from './model-presets/aliyun-image.json';
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
import openaiAudioPresets from './model-presets/openai-audio.json';
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
	/** English import fallback written to the existing models.description column. */
	description?: string | null;
	/** Localized Catalog display copy; not persisted as a separate database field. */
	i18n?: {
		en: string;
		zh: string;
	};
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	/** OpenRouter-style input/output modalities. */
	modalities?: StaticModelPresetModalities;
	/** Model release date `YYYY-MM-DD`. */
	released?: string | null;
	pricing: {
		/** Catalog branch written as `pricing_profile` (tiers / image / audio plus optional `schedule`). */
		usd: unknown;
		cny: unknown;
	};
};

const STATIC_MODEL_PRESETS_BY_VENDOR = [
	aliyunPresets,
	aliyunImagePresets,
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
	openaiAudioPresets,
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
	return [...STATIC_MODEL_PRESETS_BY_VENDOR.flat()] as StaticModelPresetRow[];
}

/** Returns the `usd` / `cny` object as-is, including optional catalog `schedule`. */
export function pickPresetPricingRawForBillingCurrency(
	preset: StaticModelPresetRow,
	billing: GatewaySupportedBillingCurrency
): unknown {
	return billing === 'CNY' ? preset.pricing.cny : preset.pricing.usd;
}
