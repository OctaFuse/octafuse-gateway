/**
 * 按引擎技术上限切段（与计费粒度 billingUnitChars 无关）。
 */

export type TextSegment = {
	index: number;
	text: string;
	charCount: number;
};

/**
 * Split text at paragraph boundaries; each segment ≤ maxChars.
 * Prefer newline breaks; hard-split when a single paragraph exceeds maxChars.
 * 字数按 Unicode code point（`[...str].length`）。
 */
export function segmentTextForDetection(text: string, maxChars: number): TextSegment[] {
	const normalized = text.replace(/\r\n/g, '\n').trim();
	if (!normalized) {
		return [];
	}
	if (maxChars < 1) {
		throw new Error('maxChars must be >= 1');
	}

	const paragraphs = normalized.split(/\n{2,}/);
	const chunks: string[] = [];
	let buffer = '';

	function flushBuffer() {
		if (buffer.trim()) {
			chunks.push(buffer.trim());
		}
		buffer = '';
	}

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) {
			continue;
		}

		const trimmedChars = [...trimmed];
		if (trimmedChars.length > maxChars) {
			flushBuffer();
			for (let i = 0; i < trimmedChars.length; i += maxChars) {
				chunks.push(trimmedChars.slice(i, i + maxChars).join(''));
			}
			continue;
		}

		const candidate = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
		if ([...candidate].length <= maxChars) {
			buffer = candidate;
		} else {
			flushBuffer();
			buffer = trimmed;
		}
	}
	flushBuffer();

	return chunks.map((chunk, index) => ({
		index,
		text: chunk,
		charCount: [...chunk].length,
	}));
}
