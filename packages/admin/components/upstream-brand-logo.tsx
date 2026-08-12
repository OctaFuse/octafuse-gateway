"use client";

/* eslint-disable @next/next/no-img-element -- 协议 Logo 是固定尺寸品牌资源，直接使用原始地址可避免图片代理改写供应商资产。 */

/**
 * 上游协议品牌图标：OpenAI 用静态 SVG，Anthropic/Gemini 用 simple-icons；列表密集场景用 `UpstreamProtocolBrandIcon`。
 * DashScope 使用阿里云提供的 56×56 PNG 品牌资产。
 */
import type { SimpleIcon } from "simple-icons";
import { siAnthropic, siGooglegemini } from "simple-icons";
import { useTranslations } from "next-intl";

const DASHSCOPE_ICON_URL =
	"https://img.alicdn.com/imgextra/i4/O1CN01YDrZSq1jY4mWMcVoy_!!6000000004559-2-tps-56-56.png";

type Props = {
	className?: string;
	/** 读屏/无障碍文案（如 `sr-only` 或 `<title>`） */
	label: string;
};

/**
 * Simple Icons 品牌路径（24×24 viewBox，填充色为官方 hex）。
 * @see https://github.com/simple-icons/simple-icons (CC0-1.0)
 */
function SimpleBrandIcon({
	icon,
	className = "h-4 w-4",
	label,
}: Props & { icon: SimpleIcon }) {
	return (
		<svg
			role="img"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			className={className}
			aria-hidden
		>
			<title>{label}</title>
			<path fill={`#${icon.hex}`} d={icon.path} />
		</svg>
	);
}

/**
 * OpenAI 徽标（`/public/brand/openai-emblem.svg`）；商标归 OpenAI，绿色与品牌常见用法一致。
 */
type OpenAiProps = Props & { iconClassName?: string };

/** OpenAI 协议行内图标（img + sr-only 标签）。 */
export function OpenAiEndpointIcon({
	className,
	label,
	iconClassName,
}: OpenAiProps) {
	return (
		<span className={className}>
			<img
				src="/brand/openai-emblem.svg"
				alt=""
				width={16}
				height={16}
				className={iconClassName ?? "h-4 w-4 shrink-0 block max-w-none"}
				draggable={false}
			/>
			<span className="sr-only">{label}</span>
		</span>
	);
}

/** Anthropic（Claude）协议图标。 */
export function AnthropicEndpointIcon(props: Props) {
	return <SimpleBrandIcon icon={siAnthropic} {...props} />;
}

/** Google Gemini 协议图标。 */
export function GeminiEndpointIcon(props: Props) {
	return <SimpleBrandIcon icon={siGooglegemini} {...props} />;
}

/** 根据 `upstream_protocol` 渲染对应品牌；未知协议显示缩写占位块。 */
export function UpstreamProtocolBrandIcon({
	protocol,
	size = "compact",
}: {
	protocol: string;
	/** `compact`≈14px；`default`≈16px（与供应商表对齐） */
	size?: "compact" | "default";
}) {
	const t = useTranslations("upstream");
	const p = protocol.trim().toLowerCase();
	const label =
		p === "openai"
			? t("openai")
			: p === "anthropic"
			? t("anthropic")
			: p === "gemini"
			? t("gemini")
			: p === "dashscope"
			? t("dashscope")
			: t("protocolUnknown", { protocol });
	const iconCls = size === "compact" ? "h-3.5 w-3.5" : "h-4 w-4";

	if (p === "openai") {
		return (
			<span className="inline-flex" title={label}>
				<OpenAiEndpointIcon
					label={label}
					className="inline-flex"
					iconClassName={`${iconCls} shrink-0 block max-w-none`}
				/>
			</span>
		);
	}
	if (p === "anthropic") {
		return (
			<span className="inline-flex" title={label}>
				<AnthropicEndpointIcon label={label} className={iconCls} />
			</span>
		);
	}
	if (p === "gemini") {
		return (
			<span className="inline-flex" title={label}>
				<GeminiEndpointIcon label={label} className={iconCls} />
			</span>
		);
	}
	if (p === "dashscope") {
		return (
			<span className="inline-flex" title={label}>
				<img
					src={DASHSCOPE_ICON_URL}
					alt=""
					width={56}
					height={56}
					className={`${iconCls} shrink-0 block max-w-none`}
					draggable={false}
				/>
				<span className="sr-only">{label}</span>
			</span>
		);
	}
	return (
		<span
			className="inline-flex min-h-[1rem] items-center justify-center rounded border border-amber-200 bg-amber-50 px-1 text-[9px] font-mono uppercase text-amber-900"
			title={protocol}
		>
			{protocol.slice(0, 6)}
		</span>
	);
}
