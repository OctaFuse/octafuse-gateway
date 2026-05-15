/**
 * 管理端内置 model 静态目录：用于一键导入 `models` 表。
 *
 * **厂商 key 以 `model-vendors.json` 为准**。每个 catalog key 对应 **`model-presets/<key>.json`**；
 * 无内置模型时文件为 **`[]` 占位**，后续在该文件中追加对象即可。
 *
 * 各预设内 **`pricing.usd`** 与 D1 导出 `data/remote/.../data-remote-table-models-*.sql` 中 `pricing_profile` 一致（美元口径）；
 * **`pricing.cny`** 以中国区 Postgres 导出为准（无 CN 价的模型仍为 USD 换算占位）。
 * 导入时按当前 `BILLING_CURRENCY` 选用 `usd` / `cny` 之一写入 `pricing_profile`。
 *
 * 合并顺序：**与 `model-vendors.json` 中 key 顺序一致**（含空占位文件）。
 */
import aliyunPresets from './model-presets/aliyun.json';
import amazonPresets from './model-presets/amazon.json';
import anthropicPresets from './model-presets/anthropic.json';
import azurePresets from './model-presets/azure.json';
import baichuanPresets from './model-presets/baichuan.json';
import baiduPresets from './model-presets/baidu.json';
import bytedancePresets from './model-presets/bytedance.json';
import coherePresets from './model-presets/cohere.json';
import deepseekPresets from './model-presets/deepseek.json';
import fireworksPresets from './model-presets/fireworks.json';
import googlePresets from './model-presets/google.json';
import groqPresets from './model-presets/groq.json';
import huaweiPresets from './model-presets/huawei.json';
import ibmPresets from './model-presets/ibm.json';
import metaPresets from './model-presets/meta.json';
import minimaxPresets from './model-presets/minimax.json';
import mistralPresets from './model-presets/mistral.json';
import moonshotPresets from './model-presets/moonshot.json';
import nvidiaPresets from './model-presets/nvidia.json';
import openaiPresets from './model-presets/openai.json';
import perplexityPresets from './model-presets/perplexity.json';
import stabilityPresets from './model-presets/stability.json';
import stepfunPresets from './model-presets/stepfun.json';
import tencentPresets from './model-presets/tencent.json';
import togetherPresets from './model-presets/together.json';
import volcenginePresets from './model-presets/volcengine.json';
import xaiPresets from './model-presets/xai.json';
import xiaomiPresets from './model-presets/xiaomi.json';
import zhipuPresets from './model-presets/zhipu.json';
import ollamaPresets from './model-presets/ollama.json';
import openrouterPresets from './model-presets/openrouter.json';
import siliconflowPresets from './model-presets/siliconflow.json';
import otherPresets from './model-presets/other.json';
import type { GatewaySupportedBillingCurrency } from '@octafuse/core/lib/billing-currency';

export type StaticModelPresetRow = {
	id: string;
	display_name?: string | null;
	vendor?: string | null;
	context_window?: number | null;
	max_tokens?: number | null;
	pricing: {
		usd: unknown;
		cny: unknown;
	};
};

const STATIC_MODEL_PRESETS_BY_VENDOR = [
	aliyunPresets,
	amazonPresets,
	anthropicPresets,
	azurePresets,
	baichuanPresets,
	baiduPresets,
	bytedancePresets,
	coherePresets,
	deepseekPresets,
	fireworksPresets,
	googlePresets,
	groqPresets,
	huaweiPresets,
	ibmPresets,
	metaPresets,
	minimaxPresets,
	mistralPresets,
	moonshotPresets,
	nvidiaPresets,
	openaiPresets,
	perplexityPresets,
	stabilityPresets,
	stepfunPresets,
	tencentPresets,
	togetherPresets,
	volcenginePresets,
	xaiPresets,
	xiaomiPresets,
	zhipuPresets,
	ollamaPresets,
	openrouterPresets,
	siliconflowPresets,
	otherPresets,
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
