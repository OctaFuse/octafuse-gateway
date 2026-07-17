'use client';

import type { ImagePreviewItem } from '@/lib/image-generations';

type Props = {
	images: ImagePreviewItem[];
	/** Accessible label for the gallery region */
	label: string;
};

/** Thumbnail grid for OpenAI-compatible images generations responses. */
export function ImageGenerationsPreview({ images, label }: Props) {
	if (images.length === 0) return null;
	return (
		<div className="space-y-2" role="group" aria-label={label}>
			<div className="text-xs font-medium text-gray-600">{label}</div>
			<ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{images.map((img, i) => (
					<li
						key={`${img.kind}-${i}`}
						className="rounded-md border border-gray-200 bg-gray-50 overflow-hidden"
					>
						{/* eslint-disable-next-line @next/next/no-img-element -- dynamic b64/url from upstream */}
						<img
							src={img.src}
							alt={`${label} ${i + 1}`}
							className="w-full max-h-64 object-contain bg-white"
						/>
					</li>
				))}
			</ul>
		</div>
	);
}
