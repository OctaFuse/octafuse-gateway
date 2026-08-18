/**
 * Vendor / Provider SVG assets from the same package used by octafuse-website.
 *
 * Explicit static imports let Next emit content-hashed files under `/_next/static/media`;
 * no duplicated files or manual cache version is needed in `public/vendors`.
 */
import alibabaCloudIcon from '@lobehub/icons-static-svg/icons/alibabacloud.svg';
import anthropicIcon from '@lobehub/icons-static-svg/icons/anthropic.svg';
import awsIcon from '@lobehub/icons-static-svg/icons/aws.svg';
import azureAiIcon from '@lobehub/icons-static-svg/icons/azureai.svg';
import baichuanIcon from '@lobehub/icons-static-svg/icons/baichuan.svg';
import baiduCloudIcon from '@lobehub/icons-static-svg/icons/baiducloud.svg';
import bailianIcon from '@lobehub/icons-static-svg/icons/bailian.svg';
import bytedanceIcon from '@lobehub/icons-static-svg/icons/bytedance.svg';
import cerebrasIcon from '@lobehub/icons-static-svg/icons/cerebras.svg';
import cohereIcon from '@lobehub/icons-static-svg/icons/cohere.svg';
import deepinfraIcon from '@lobehub/icons-static-svg/icons/deepinfra.svg';
import deepseekIcon from '@lobehub/icons-static-svg/icons/deepseek.svg';
import fireworksIcon from '@lobehub/icons-static-svg/icons/fireworks.svg';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini.svg';
import groqIcon from '@lobehub/icons-static-svg/icons/groq.svg';
import huggingfaceIcon from '@lobehub/icons-static-svg/icons/huggingface.svg';
import huaweiCloudIcon from '@lobehub/icons-static-svg/icons/huaweicloud.svg';
import hunyuanIcon from '@lobehub/icons-static-svg/icons/hunyuan.svg';
import ibmIcon from '@lobehub/icons-static-svg/icons/ibm.svg';
import kimiIcon from '@lobehub/icons-static-svg/icons/kimi.svg';
import longcatIcon from '@lobehub/icons-static-svg/icons/longcat.svg';
import metaIcon from '@lobehub/icons-static-svg/icons/meta.svg';
import minimaxIcon from '@lobehub/icons-static-svg/icons/minimax.svg';
import mistralIcon from '@lobehub/icons-static-svg/icons/mistral.svg';
import moonshotIcon from '@lobehub/icons-static-svg/icons/moonshot.svg';
import novitaIcon from '@lobehub/icons-static-svg/icons/novita.svg';
import nvidiaIcon from '@lobehub/icons-static-svg/icons/nvidia.svg';
import ollamaIcon from '@lobehub/icons-static-svg/icons/ollama.svg';
import openaiIcon from '@lobehub/icons-static-svg/icons/openai.svg';
import opencodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import openrouterIcon from '@lobehub/icons-static-svg/icons/openrouter.svg';
import perplexityIcon from '@lobehub/icons-static-svg/icons/perplexity.svg';
import qiniuIcon from '@lobehub/icons-static-svg/icons/qiniu.svg';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen.svg';
import sambanovaIcon from '@lobehub/icons-static-svg/icons/sambanova.svg';
import siliconCloudIcon from '@lobehub/icons-static-svg/icons/siliconcloud.svg';
import stabilityIcon from '@lobehub/icons-static-svg/icons/stability.svg';
import stepfunIcon from '@lobehub/icons-static-svg/icons/stepfun.svg';
import tencentCloudIcon from '@lobehub/icons-static-svg/icons/tencentcloud.svg';
import togetherIcon from '@lobehub/icons-static-svg/icons/together.svg';
import vercelIcon from '@lobehub/icons-static-svg/icons/vercel.svg';
import vertexAiIcon from '@lobehub/icons-static-svg/icons/vertexai.svg';
import volcengineIcon from '@lobehub/icons-static-svg/icons/volcengine.svg';
import xaiIcon from '@lobehub/icons-static-svg/icons/xai.svg';
import xiaomiMimoIcon from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import zaiIcon from '@lobehub/icons-static-svg/icons/zai.svg';
import zenmuxIcon from '@lobehub/icons-static-svg/icons/zenmux.svg';
import zhipuIcon from '@lobehub/icons-static-svg/icons/zhipu.svg';

type StaticSvgAsset = string | { src: string };

function assetUrl(asset: StaticSvgAsset): string {
	return typeof asset === 'string' ? asset : asset.src;
}

export const vendorIconAssets: Readonly<Record<string, string>> = {
	aliyun: assetUrl(alibabaCloudIcon),
	amazon: assetUrl(awsIcon),
	anthropic: assetUrl(anthropicIcon),
	azure: assetUrl(azureAiIcon),
	baichuan: assetUrl(baichuanIcon),
	baidu: assetUrl(baiduCloudIcon),
	bytedance: assetUrl(bytedanceIcon),
	cerebras: assetUrl(cerebrasIcon),
	cohere: assetUrl(cohereIcon),
	deepinfra: assetUrl(deepinfraIcon),
	deepseek: assetUrl(deepseekIcon),
	fireworks: assetUrl(fireworksIcon),
	google: assetUrl(geminiIcon),
	groq: assetUrl(groqIcon),
	huggingface: assetUrl(huggingfaceIcon),
	huawei: assetUrl(huaweiCloudIcon),
	ibm: assetUrl(ibmIcon),
	meituan: assetUrl(longcatIcon),
	meta: assetUrl(metaIcon),
	minimax: assetUrl(minimaxIcon),
	mistral: assetUrl(mistralIcon),
	moonshot: assetUrl(moonshotIcon),
	novita: assetUrl(novitaIcon),
	nvidia: assetUrl(nvidiaIcon),
	ollama: assetUrl(ollamaIcon),
	openai: assetUrl(openaiIcon),
	opencode: assetUrl(opencodeIcon),
	openrouter: assetUrl(openrouterIcon),
	perplexity: assetUrl(perplexityIcon),
	qiniu: assetUrl(qiniuIcon),
	sambanova: assetUrl(sambanovaIcon),
	siliconflow: assetUrl(siliconCloudIcon),
	stability: assetUrl(stabilityIcon),
	stepfun: assetUrl(stepfunIcon),
	tencent: assetUrl(tencentCloudIcon),
	together: assetUrl(togetherIcon),
	vercel: assetUrl(vercelIcon),
	volcengine: assetUrl(volcengineIcon),
	xai: assetUrl(xaiIcon),
	xiaomi: assetUrl(xiaomiMimoIcon),
	zenmux: assetUrl(zenmuxIcon),
	zhipu: assetUrl(zhipuIcon),
};

export const productIconAssets: Readonly<Record<string, string>> = {
	bailian: assetUrl(bailianIcon),
	hunyuan: assetUrl(hunyuanIcon),
	kimi: assetUrl(kimiIcon),
	longcat: assetUrl(longcatIcon),
	qwen: assetUrl(qwenIcon),
	vertexai: assetUrl(vertexAiIcon),
	xiaomimimo: assetUrl(xiaomiMimoIcon),
	zai: assetUrl(zaiIcon),
};
