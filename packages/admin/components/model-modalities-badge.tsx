'use client';

/**
 * OpenRouter-style modality chips: colored icon badges for input → output.
 * @see https://openrouter.ai/xiaomi/mimo-v2.5
 */
import {
	DocumentIcon,
	PhotoIcon,
	VideoCameraIcon,
} from '@heroicons/react/24/solid';
import { parseModelModalitiesJson } from '@octafuse/core/db/model-modalities';

const MODALITY_ORDER = ['text', 'image', 'audio', 'video', 'file'] as const;

type ModalityKey = (typeof MODALITY_ORDER)[number];

const MODALITY_STYLES: Record<
	ModalityKey,
	{ label: string; chip: string; icon?: 'text' | 'photo' | 'audio' | 'video' | 'file' }
> = {
	text: {
		label: 'Text',
		chip: 'bg-blue-100 text-blue-700 ring-blue-200/80',
		icon: 'text',
	},
	image: {
		label: 'Image',
		chip: 'bg-emerald-100 text-emerald-700 ring-emerald-200/80',
		icon: 'photo',
	},
	audio: {
		label: 'Audio',
		chip: 'bg-violet-100 text-violet-700 ring-violet-200/80',
		icon: 'audio',
	},
	video: {
		label: 'Video',
		chip: 'bg-amber-100 text-amber-700 ring-amber-200/80',
		icon: 'video',
	},
	file: {
		label: 'File',
		chip: 'bg-slate-100 text-slate-600 ring-slate-200/80',
		icon: 'file',
	},
};

function sortModalities(modalities: string[]): ModalityKey[] {
	const set = new Set(modalities.map((m) => m.trim().toLowerCase()));
	return MODALITY_ORDER.filter((m) => set.has(m));
}

function AudioWaveIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
			<rect x="1" y="6" width="1.5" height="4" rx="0.75" />
			<rect x="4" y="4" width="1.5" height="8" rx="0.75" />
			<rect x="7" y="2" width="1.5" height="12" rx="0.75" />
			<rect x="10" y="5" width="1.5" height="6" rx="0.75" />
			<rect x="13" y="7" width="1.5" height="2" rx="0.75" />
		</svg>
	);
}

function ModalityChip({
	modality,
	size,
}: {
	modality: ModalityKey;
	size: 'sm' | 'md';
}) {
	const style = MODALITY_STYLES[modality];
	const box =
		size === 'sm'
			? 'h-5 w-5 rounded-[4px] ring-1'
			: 'h-6 w-6 rounded-[5px] ring-1';
	const iconClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';
	const textClass = size === 'sm' ? 'text-[10px] font-bold' : 'text-[11px] font-bold';

	return (
		<span
			className={`inline-flex shrink-0 items-center justify-center ${box} ${style.chip}`}
			title={style.label}
			aria-label={style.label}
		>
			{style.icon === 'text' ? (
				<span className={`leading-none ${textClass}`}>T</span>
			) : style.icon === 'photo' ? (
				<PhotoIcon className={iconClass} />
			) : style.icon === 'audio' ? (
				<AudioWaveIcon className={iconClass} />
			) : style.icon === 'video' ? (
				<VideoCameraIcon className={iconClass} />
			) : (
				<DocumentIcon className={iconClass} />
			)}
		</span>
	);
}

export function ModelModalityChips({
	modalities,
	size = 'sm',
}: {
	modalities: string[] | null | undefined;
	size?: 'sm' | 'md';
}) {
	return <ModalityGroup modalities={modalities} size={size} />;
}

function ModalityGroup({
	modalities,
	size,
}: {
	modalities: string[] | null | undefined;
	size: 'sm' | 'md';
}) {
	const sorted = sortModalities(modalities ?? []);
	if (sorted.length === 0) {
		return <span className="text-xs text-gray-400">—</span>;
	}
	return (
		<span className="inline-flex items-center gap-0.5">
			{sorted.map((m) => (
				<ModalityChip key={m} modality={m} size={size} />
			))}
		</span>
	);
}

export function parseModalitiesValue(value: unknown): string[] | null {
	if (value == null) return null;
	if (Array.isArray(value)) {
		const list = value.map((m) => String(m).trim().toLowerCase()).filter(Boolean);
		return list.length > 0 ? list : null;
	}
	if (typeof value === 'string') {
		return parseModelModalitiesJson(value);
	}
	return null;
}

export function ModelModalitiesBadge({
	inputModalities,
	outputModalities,
	size = 'sm',
	className = '',
}: {
	inputModalities: string[] | null | undefined;
	outputModalities: string[] | null | undefined;
	size?: 'sm' | 'md';
	className?: string;
}) {
	const input = sortModalities(inputModalities ?? []);
	const output = sortModalities(outputModalities ?? []);
	if (input.length === 0 && output.length === 0) {
		return <span className="text-xs text-gray-400">—</span>;
	}

	const arrowClass = size === 'sm' ? 'mx-1 text-[10px]' : 'mx-1.5 text-xs';

	return (
		<span
			className={`inline-flex flex-wrap items-center gap-y-1 ${className}`}
			aria-label={`Input modalities: ${input.join(', ') || 'none'}; output: ${output.join(', ') || 'none'}`}
		>
			<ModalityGroup modalities={input} size={size} />
			<span className={`text-gray-400 ${arrowClass}`} aria-hidden>
				→
			</span>
			<ModalityGroup modalities={output} size={size} />
		</span>
	);
}

export function ModelModalitiesBadgeFromRaw({
	inputRaw,
	outputRaw,
	size = 'sm',
	className = '',
}: {
	inputRaw: string | null | undefined;
	outputRaw: string | null | undefined;
	size?: 'sm' | 'md';
	className?: string;
}) {
	return (
		<ModelModalitiesBadge
			inputModalities={parseModelModalitiesJson(inputRaw)}
			outputModalities={parseModelModalitiesJson(outputRaw)}
			size={size}
			className={className}
		/>
	);
}
