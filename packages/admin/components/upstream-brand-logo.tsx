/**
 * 上游协议品牌图标：OpenAI 用静态 SVG，Anthropic/Gemini 用 simple-icons；列表密集场景用 `UpstreamProtocolBrandIcon`。
 */
import type { SimpleIcon } from 'simple-icons';
import { siAnthropic, siGooglegemini } from 'simple-icons';

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
  className = 'h-4 w-4',
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
export function OpenAiEndpointIcon({ className, label, iconClassName }: OpenAiProps) {
  return (
    <span className={className}>
      <img
        src="/brand/openai-emblem.svg"
        alt=""
        width={16}
        height={16}
        className={iconClassName ?? 'h-4 w-4 shrink-0 block max-w-none'}
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

const PROTOCOL_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
};

/** 根据 `upstream_protocol` 渲染对应品牌；未知协议显示缩写占位块。 */
export function UpstreamProtocolBrandIcon({
  protocol,
  size = 'compact',
}: {
  protocol: string;
  /** `compact`≈14px；`default`≈16px（与供应商表对齐） */
  size?: 'compact' | 'default';
}) {
  const p = protocol.trim().toLowerCase();
  const label = PROTOCOL_LABEL[p] ?? `Protocol: ${protocol}`;
  const iconCls = size === 'compact' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  if (p === 'openai') {
    return (
      <span className="inline-flex" title={label}>
        <OpenAiEndpointIcon label={label} className="inline-flex" iconClassName={`${iconCls} shrink-0 block max-w-none`} />
      </span>
    );
  }
  if (p === 'anthropic') {
    return (
      <span className="inline-flex" title={label}>
        <AnthropicEndpointIcon label={label} className={iconCls} />
      </span>
    );
  }
  if (p === 'gemini') {
    return (
      <span className="inline-flex" title={label}>
        <GeminiEndpointIcon label={label} className={iconCls} />
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
