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
 * - `<vendor>-audio-asr.json` — 语音转写 ASR（`audio_billing_mode: per_second | token`）
 * - `<vendor>-audio-tts.json` — 语音合成 TTS（`audio_billing_mode: per_character | token`）
 * - `<vendor>-embedding.json` — 向量模型（`modalities.output` 为 `embedding`；仅按输入 token 计费，output / cache 价为 0 / null）
 *
 * 各预设内 **`pricing.usd`** 与 D1 导出 `data/remote/.../data-remote-table-models-*.sql` 中 `pricing_profile` 一致（美元口径）；
 * **`pricing.cny`**：有官方人民币标价的（国内厂商，以中国区官方/Postgres 价为准）取官方价；没有的（海外厂商，如 openai / anthropic / google / xai / elevenlabs 等）一律按 **USD × 7** 换算占位，不使用实时汇率，且不得留空（测试会拦截）。
 * 导入时按当前 `BILLING_CURRENCY` 选用 `usd` / `cny` **整段**写入 `pricing_profile`（含可选 `schedule` 官方时段，不只 `tiers`）。
 * DeepSeek V4 / V4.1 目录价为空闲价；`schedule` 为北京时间工作日高峰 09:00–12:00、14:00–18:00、`factor` 2。命中按 `BUSINESS_TIMEZONE` 墙钟，中国区请设 `Asia/Shanghai`。
 * Google Gemini 目录价为 Standard 标准价，不含限时导入价、Batch、Flex。Flash 3.7 / 3.8 写入 $1.50 / $7.50，而不是 2026-12-31 前的 $0.75 / $3.75。
 * Gemini 4 Argon 目录价为 2026-12-01 起的 Standard 刊例 $4 / $20，缓存读取 $0.20；不含 2026-11-30 前的入门价 $2 / $10。只支持隐式缓存，`cache_write_price` 留空。上下文与长解码上限为 1M（1000000），同步默认输出 64K（64000）记在 `max_tokens` 与介绍里。输入含文本、图像、音频、视频与 PDF。`gemini-4-barium` 无官方刊例，不入库。
 * Claude Sonnet 5 目录价为官方标准价 $2 / $10（2026-08-10 起入门价转正，不再使用原定 9 月 1 日的 $3 / $15）。
 * GPT-5.6 Terra / Luna 目录价为 2026-07-30 起的标准价 $2 / $12 与 $0.20 / $1.20；GPT-5.6 Sol 与 `gpt-5.6` 别名仍写刊例 $5 / $30，不含至少到 2026-11-21 的促销价。
 * GPT-6 Sol / Luna 目录价为 2026-09-22 起的 Standard 刊例：短上下文 $2 / $10 与 $0.10 / $0.50；输入超过 272K 时整单按 2 倍输入与缓存、1.5 倍输出。不含 Batch、Flex 半价与 Fast 双倍。
 * GPT-6.1 Sol 目录价为 2026-09-29 起的 Standard 刊例：短上下文输入/输出与 Sol 相同（$2 / $10），缓存读取为未缓存输入的 5%（$0.10 / $0.20），不是 Sol 的 10%。不含 Batch、Flex 半价、Fast 双倍，以及尚未作为刊例写入的 Ultrafast。
 * Claude Opus 5.5 目录价为 $4 / $20；缓存读取 $0.20，`cache_write_price` 取 5 分钟写入 $5（1 小时写入 $8 不单列）。
 * Grok 4.7 目录价与 Grok 4.6 相同（200K 阶梯，$2 / $6 与 $4 / $12）。不含仅 Cursor / Grok Build 提供的 Fast 双倍价。官方未公布文本输出上限，`max_tokens` 沿用同系 128000。
 * Xiaomi MiMo-V2.6 目录价为实时推理刊例（USD / CNY 分源）。Pro 与 Flash 的批量推理半价不写入 preset；UltraSpeed 无批量推理。缓存写入官网标明限时免费，`cache_write_price` 保持 null。
 * MiniMax M3 目录价为官方标准现价（按量页永久五折后的价格）：输入 ≤512K 时美元 $0.30 / $1.20、缓存读取 $0.06，中国区 ¥2.10 / ¥8.40、缓存读取 ¥0.42；输入超过 512K 时整档加倍。不含 Priority 与划线原价。`cache_write_price` 留空。
 * MiniMax M3.1 Flash 目录价为 2026-10-19 起的官方单一档标准刊例：美元 $0.15 / $0.60，缓存读取 $0.015；中国区按量价 ¥1 / ¥4，缓存读取 ¥0.1。不含 Priority。`cache_write_price` 留空。预览 id `minimax-m3.1-flash-preview` 已从静态目录移除。
 * Kimi K3.1 Pro / Highspeed 目录价取 2026-10-23 的 platform.kimi.ai 与 platform.kimi.com 首页刊例。Pro：美元 $2 / $10、缓存读取 $0.20、缓存写入 $2；人民币 ¥13 / ¥68、缓存读取 ¥1.30、缓存写入 ¥13。Highspeed：美元 $4 / $20、缓存读取 $0.20、缓存写入 $4；人民币 ¥26 / ¥136、缓存读取 ¥1.30、缓存写入 ¥26。高速版缓存命中与 Pro 相同，不是输入价的 10%。`cache_write_price` 取默认 5 分钟档；1 小时档官网只以 kimi-k3 举例为 5 分钟的 2 倍，K3.1 未单列，不写入。上下文与最大输出按 1M 记为 1000000。
 * 面向管理后台的英文摘要与中、英、日、韩介绍均与模型预设共同维护，按界面语言只读展示，不写入数据库。
 *
 * 合并顺序：与下方 import 列表一致（尚未录入价目的厂商保留 `[]` 占位文件；image 文件紧挨同 vendor 的 LLM 之后）。
 */
import aliyunPresets from './model-presets/aliyun.json';
import aliyunImagePresets from './model-presets/aliyun-image.json';
import aliyunEmbeddingPresets from './model-presets/aliyun-embedding.json';
import aliyunAudioAsrPresets from './model-presets/aliyun-audio-asr.json';
import aliyunAudioTtsPresets from './model-presets/aliyun-audio-tts.json';
import anthropicPresets from './model-presets/anthropic.json';
import baichuanPresets from './model-presets/baichuan.json';
import baiduPresets from './model-presets/baidu.json';
import bytedancePresets from './model-presets/bytedance.json';
import bytedanceImagePresets from './model-presets/bytedance-image.json';
import coherePresets from './model-presets/cohere.json';
import deepseekPresets from './model-presets/deepseek.json';
import elevenlabsAudioTtsPresets from './model-presets/elevenlabs-audio-tts.json';
import elevenlabsAudioAsrPresets from './model-presets/elevenlabs-audio-asr.json';
import googlePresets from './model-presets/google.json';
import googleImagePresets from './model-presets/google-image.json';
import googleEmbeddingPresets from './model-presets/google-embedding.json';
import meituanPresets from './model-presets/meituan.json';
import metaPresets from './model-presets/meta.json';
import minimaxPresets from './model-presets/minimax.json';
import minimaxImagePresets from './model-presets/minimax-image.json';
import minimaxAudioAsrPresets from './model-presets/minimax-audio-asr.json';
import minimaxAudioTtsPresets from './model-presets/minimax-audio-tts.json';
import mistralPresets from './model-presets/mistral.json';
import moonshotPresets from './model-presets/moonshot.json';
import openaiPresets from './model-presets/openai.json';
import openaiImagePresets from './model-presets/openai-image.json';
import openaiAudioAsrPresets from './model-presets/openai-audio-asr.json';
import openaiEmbeddingPresets from './model-presets/openai-embedding.json';
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
	/** English catalog summary. Shown when `i18n.en` is absent. */
	description?: string | null;
	/** Localized catalog introductions. Admin displays these; they are not stored. */
	i18n?: {
		en: string;
		zh: string;
		ja: string;
		ko: string;
	};
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	/** OpenRouter-style input/output modalities. */
	modalities?: StaticModelPresetModalities;
	/** Model release date `YYYY-MM-DD`. */
	released?: string | null;
	/** Vendor retirement date `YYYY-MM-DD`; omitted/null = still offered. */
	retired?: string | null;
	pricing: {
		/** Catalog branch written as `pricing_profile` (tiers / image / audio plus optional `schedule`). */
		usd: unknown;
		cny: unknown;
	};
};

const STATIC_MODEL_PRESETS_BY_VENDOR = [
	aliyunPresets,
	aliyunImagePresets,
	aliyunEmbeddingPresets,
	aliyunAudioAsrPresets,
	aliyunAudioTtsPresets,
	anthropicPresets,
	baichuanPresets,
	baiduPresets,
	bytedancePresets,
	bytedanceImagePresets,
	coherePresets,
	deepseekPresets,
	elevenlabsAudioTtsPresets,
	elevenlabsAudioAsrPresets,
	googlePresets,
	googleImagePresets,
	googleEmbeddingPresets,
	meituanPresets,
	metaPresets,
	minimaxPresets,
	minimaxImagePresets,
	minimaxAudioAsrPresets,
	minimaxAudioTtsPresets,
	mistralPresets,
	moonshotPresets,
	openaiPresets,
	openaiImagePresets,
	openaiAudioAsrPresets,
	openaiEmbeddingPresets,
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

let retiredByModelId: Map<string, string> | null = null;

/** 内置目录里该模型的退役日期（`YYYY-MM-DD`）；目录无此 id 或未公布日期时为 null。不落库，随版本更新。 */
export function getStaticModelPresetRetired(modelId: string): string | null {
	if (!retiredByModelId) {
		retiredByModelId = new Map();
		for (const preset of listStaticModelPresets()) {
			const id = String(preset.id ?? '').trim();
			const retired = preset.retired?.trim();
			if (id && retired) retiredByModelId.set(id, retired);
		}
	}
	return retiredByModelId.get(modelId.trim()) ?? null;
}

export type ModelCatalogCopy = {
	en: string | null;
	zh: string | null;
	ja: string | null;
	ko: string | null;
};

/** 目录介绍。英文缺省时用顶层 `description`；其他语言缺省时回退英文。 */
export function modelPresetCatalogCopy(
	preset: Pick<StaticModelPresetRow, 'description' | 'i18n'>
): ModelCatalogCopy {
	const en = preset.i18n?.en?.trim() || preset.description?.trim() || '';
	const zh = preset.i18n?.zh?.trim() || en;
	const ja = preset.i18n?.ja?.trim() || en;
	const ko = preset.i18n?.ko?.trim() || en;
	return {
		en: en || null,
		zh: zh || null,
		ja: ja || null,
		ko: ko || null,
	};
}

let catalogCopyByModelId: Map<string, { en: string; zh: string; ja: string; ko: string }> | null = null;

/** 按 `models.id` 取静态介绍。目录没有该模型，或四种语言都为空时返回 null。 */
export function getStaticModelCatalogCopy(
	modelId: string
): { en: string; zh: string; ja: string; ko: string } | null {
	if (!catalogCopyByModelId) {
		catalogCopyByModelId = new Map();
		for (const preset of listStaticModelPresets()) {
			const id = String(preset.id ?? '').trim();
			const copy = modelPresetCatalogCopy(preset);
			if (!id || (!copy.en && !copy.zh && !copy.ja && !copy.ko)) continue;
			catalogCopyByModelId.set(id, {
				en: copy.en ?? '',
				zh: copy.zh ?? '',
				ja: copy.ja ?? '',
				ko: copy.ko ?? '',
			});
		}
	}
	return catalogCopyByModelId.get(modelId.trim()) ?? null;
}

/** Returns the `usd` / `cny` object as-is, including optional catalog `schedule`. */
export function pickPresetPricingRawForBillingCurrency(
	preset: StaticModelPresetRow,
	billing: GatewaySupportedBillingCurrency
): unknown {
	return billing === 'CNY' ? preset.pricing.cny : preset.pricing.usd;
}
