/**
 * Gateway Vendor / Provider 产品图标。
 *
 * 与 octafuse-website Catalog 使用相同的单色 SVG、品牌色与 Mask 渲染方式：
 * - Vendor / Model 默认按 vendor key 展示；
 * - Provider 可通过 iconKey 使用产品级 Logo（MiMo、Qwen、Vertex AI 等）；
 * - 未知项使用文字缩写，不依赖占位图片。
 */
import type { CSSProperties } from 'react';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { productIconAssets, vendorIconAssets } from './vendor-icon-assets';

type IconVisual = {
	url?: string;
	accent: string;
	label?: string;
};

/** 与 Website `CatalogExplorer.astro` 的 vendorVisuals 保持一致。 */
const VENDOR_VISUALS: Record<string, IconVisual> = {
	aliyun: { url: vendorIconAssets.aliyun, accent: '#ff6a00' },
	amazon: { url: vendorIconAssets.amazon, accent: '#ff9900' },
	anthropic: { url: vendorIconAssets.anthropic, accent: '#d4a27f' },
	azure: { url: vendorIconAssets.azure, accent: '#0078d4' },
	baichuan: { url: vendorIconAssets.baichuan, accent: '#625bff' },
	baidu: { url: vendorIconAssets.baidu, accent: '#2932e1' },
	bytedance: { url: vendorIconAssets.bytedance, accent: '#00c8d7' },
	cerebras: { url: vendorIconAssets.cerebras, accent: '#f15a24' },
	cohere: { url: vendorIconAssets.cohere, accent: '#39594d' },
	commandcode: { accent: '#111827' },
	deepinfra: { url: vendorIconAssets.deepinfra, accent: '#0ea5e9' },
	deepseek: { url: vendorIconAssets.deepseek, accent: '#4d6bfe' },
	fireworks: { url: vendorIconAssets.fireworks, accent: '#ff5f56' },
	google: { url: vendorIconAssets.google, accent: '#4285f4' },
	groq: { url: vendorIconAssets.groq, accent: '#f55036' },
	huggingface: { url: vendorIconAssets.huggingface, accent: '#ff9d00' },
	huawei: { url: vendorIconAssets.huawei, accent: '#cf0a2c' },
	ibm: { url: vendorIconAssets.ibm, accent: '#0f62fe' },
	meituan: { url: vendorIconAssets.meituan, accent: '#ffd100' },
	meta: { url: vendorIconAssets.meta, accent: '#0866ff' },
	minimax: { url: vendorIconAssets.minimax, accent: '#f25c54' },
	mistral: { url: vendorIconAssets.mistral, accent: '#ff7000' },
	moonshot: { url: vendorIconAssets.moonshot, accent: '#7c8ca1' },
	novita: { url: vendorIconAssets.novita, accent: '#00c2a8' },
	nvidia: { url: vendorIconAssets.nvidia, accent: '#76b900' },
	ollama: { url: vendorIconAssets.ollama, accent: '#7c8ca1' },
	openai: { url: vendorIconAssets.openai, accent: '#10a37f' },
	opencode: { url: vendorIconAssets.opencode, accent: '#f97316' },
	openrouter: { url: vendorIconAssets.openrouter, accent: '#6366f1' },
	other: { accent: '#64748b' },
	perplexity: { url: vendorIconAssets.perplexity, accent: '#20b8cd' },
	qiniu: { url: vendorIconAssets.qiniu, accent: '#00a0e9' },
	sambanova: { url: vendorIconAssets.sambanova, accent: '#ee4c2c' },
	siliconflow: { url: vendorIconAssets.siliconflow, accent: '#6d5dfc' },
	stability: { url: vendorIconAssets.stability, accent: '#7c3aed' },
	stepfun: { url: vendorIconAssets.stepfun, accent: '#2f6bff' },
	tencent: { url: vendorIconAssets.tencent, accent: '#006eff' },
	together: { url: vendorIconAssets.together, accent: '#0f62fe' },
	vercel: { url: vendorIconAssets.vercel, accent: '#000000' },
	volcengine: { url: vendorIconAssets.volcengine, accent: '#00c8d7' },
	xai: { url: vendorIconAssets.xai, accent: '#6b7280' },
	xiaomi: { url: vendorIconAssets.xiaomi, accent: '#ff6900' },
	zenmux: { url: vendorIconAssets.zenmux, accent: '#7c5cff' },
	zhipu: { url: vendorIconAssets.zhipu, accent: '#1f5eff' },
};

/** Provider 产品级视觉；母公司与产品品牌不同时优先使用。 */
const PRODUCT_VISUALS: Record<string, IconVisual> = {
	bailian: { url: productIconAssets.bailian, accent: '#ff6a00', label: 'Alibaba Cloud Bailian' },
	hunyuan: { url: productIconAssets.hunyuan, accent: '#006eff', label: 'Tencent Hunyuan' },
	kimi: { url: productIconAssets.kimi, accent: '#7c8ca1', label: 'Kimi' },
	longcat: { url: productIconAssets.longcat, accent: '#ffd100', label: 'LongCat' },
	qwen: { url: productIconAssets.qwen, accent: '#615ced', label: 'Qwen' },
	vertexai: { url: productIconAssets.vertexai, accent: '#4285f4', label: 'Google Vertex AI' },
	xiaomimimo: { url: productIconAssets.xiaomimimo, accent: '#ff6900', label: 'Xiaomi MiMo' },
	zai: { url: productIconAssets.zai, accent: '#1f5eff', label: 'Z.AI' },
};

type Props = {
	vendor: string | null | undefined;
	/** Provider 产品级图标；省略时使用 Vendor 图标。 */
	iconKey?: string | null;
	/** `compact`≈28px；`default`≈32px；`identity`≈48px（卡片标题区双行高度） */
	size?: 'compact' | 'default' | 'identity';
	className?: string;
};

const SIZE_CLASSES = {
	compact: { box: 'h-7 w-7', glyph: 'h-[18px] w-[18px]', text: 'text-[9px]' },
	default: { box: 'h-8 w-8', glyph: 'h-5 w-5', text: 'text-[10px]' },
	identity: { box: 'h-12 w-12', glyph: 'h-8 w-8', text: 'text-xs' },
} as const;

function initials(label: string): string {
	return label
		.split(/[\s()/-]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => word[0])
		.join('')
		.toUpperCase();
}

function maskStyle(assetUrl: string, accent: string): CSSProperties {
	const url = `url("${assetUrl.replaceAll('"', '%22')}")`;
	return {
		backgroundColor: accent,
		WebkitMaskImage: url,
		maskImage: url,
		WebkitMaskPosition: 'center',
		maskPosition: 'center',
		WebkitMaskRepeat: 'no-repeat',
		maskRepeat: 'no-repeat',
		WebkitMaskSize: 'contain',
		maskSize: 'contain',
	};
}

export function VendorIcon({ vendor, iconKey, size = 'default', className }: Props) {
	const canonical = normalizeModelVendorInput(vendor);
	const product = PRODUCT_VISUALS[String(iconKey ?? '').trim().toLowerCase()];
	const visual = product ?? VENDOR_VISUALS[canonical] ?? VENDOR_VISUALS.other;
	const label = product?.label ?? getModelVendorLabel(canonical);
	const { box, glyph, text } = SIZE_CLASSES[size];

	return (
		<span
			className={`inline-flex shrink-0 items-center justify-center rounded-lg border ${box} ${className ?? ''}`}
			style={{
				backgroundColor: `color-mix(in srgb, ${visual.accent} 12%, white)`,
				borderColor: `color-mix(in srgb, ${visual.accent} 28%, white)`,
			}}
			title={label}
		>
			{visual.url ? (
				<span aria-hidden className={`${glyph} block`} style={maskStyle(visual.url, visual.accent)} />
			) : (
				<span aria-hidden className={`${text} font-bold leading-none`} style={{ color: visual.accent }}>
					{initials(label)}
				</span>
			)}
			<span className="sr-only">{label}</span>
		</span>
	);
}

/** Backward-compatible name for existing Model and Route surfaces. */
export const ModelVendorIcon = VendorIcon;
