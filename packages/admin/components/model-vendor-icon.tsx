/**
 * 模型厂商品牌图标：`/public/vendors/{key}.{ext}`；未知 vendor 回退 `other.svg`。
 */
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';

/** vendor key → 静态资源扩展名（与 `public/vendors/` 文件名一致）。 */
const VENDOR_ICON_EXT: Record<string, string> = {
	aliyun: 'webp',
	amazon: 'svg',
	anthropic: 'webp',
	azure: 'svg',
	baichuan: 'svg',
	baidu: 'svg',
	bytedance: 'webp',
	cohere: 'svg',
	deepseek: 'webp',
	fireworks: 'svg',
	google: 'webp',
	groq: 'svg',
	huawei: 'svg',
	ibm: 'svg',
	meta: 'svg',
	minimax: 'webp',
	mistral: 'svg',
	moonshot: 'webp',
	nvidia: 'webp',
	ollama: 'svg',
	openai: 'webp',
	openrouter: 'svg',
	other: 'svg',
	perplexity: 'svg',
	siliconflow: 'svg',
	stability: 'svg',
	stepfun: 'svg',
	tencent: 'webp',
	together: 'svg',
	volcengine: 'webp',
	xai: 'webp',
	xiaomi: 'png',
	zhipu: 'webp',
};

function vendorIconSrc(vendorKey: string): string {
	const key = normalizeModelVendorInput(vendorKey);
	const ext = VENDOR_ICON_EXT[key] ?? VENDOR_ICON_EXT.other;
	return `/vendors/${key}.${ext}`;
}

type Props = {
	vendor: string | null | undefined;
	/** `compact`≈28px；`default`≈32px；`identity`≈48px（卡片标题区双行高度） */
	size?: 'compact' | 'default' | 'identity';
	className?: string;
};

const SIZE_CLASSES = {
	compact: { box: 'h-7 w-7', img: 'h-5 w-5', px: 20 },
	default: { box: 'h-8 w-8', img: 'h-6 w-6', px: 24 },
	identity: { box: 'h-12 w-12', img: 'h-10 w-10', px: 40 },
} as const;

export function ModelVendorIcon({ vendor, size = 'default', className }: Props) {
	const canonical = normalizeModelVendorInput(vendor);
	const label = getModelVendorLabel(canonical);
	const { box, img, px } = SIZE_CLASSES[size];

	return (
		<span
			className={`inline-flex shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white ${box} ${className ?? ''}`}
			title={label}
		>
			<img
				src={vendorIconSrc(canonical)}
				alt=""
				width={px}
				height={px}
				className={`${img} block max-w-none object-contain`}
				draggable={false}
				onError={(e) => {
					const img = e.currentTarget;
					if (img.src.endsWith('/vendors/other.svg')) return;
					img.src = '/vendors/other.svg';
				}}
			/>
			<span className="sr-only">{label}</span>
		</span>
	);
}
