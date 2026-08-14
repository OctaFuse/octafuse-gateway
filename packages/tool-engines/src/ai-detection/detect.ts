/**
 * 按 driver 切段、并发检测、字符加权聚合总分。
 */

import type { ResolvedAiDetectionConfig } from '@octafuse/core/lib/ai-detection-system-config';
import { segmentTextForDetection } from './segment';
import type { AiDetectionDriver } from './types';

export const AI_DETECTION_EXCERPT_LEN = 60;
const DEFAULT_CONCURRENCY = 10;

export type DetectionSegmentResult = {
	index: number;
	chars: number;
	score: number;
	excerpt: string;
};

export type DetectionAggregateResult = {
	overallScore: number;
	totalChars: number;
	segments: DetectionSegmentResult[];
};

function excerpt(text: string, maxLen = AI_DETECTION_EXCERPT_LEN): string {
	const trimmed = text.replace(/\s+/g, ' ').trim();
	if ([...trimmed].length <= maxLen) {
		return trimmed;
	}
	return `${[...trimmed].slice(0, maxLen).join('')}…`;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker() {
		while (nextIndex < items.length) {
			const i = nextIndex;
			nextIndex += 1;
			results[i] = await fn(items[i]!, i);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
	return results;
}

/** Segment and call driver; char-weighted overall score */
export async function detectAiRate(
	text: string,
	driver: AiDetectionDriver,
	cfg: ResolvedAiDetectionConfig,
	options?: { fetchImpl?: typeof fetch; concurrency?: number }
): Promise<DetectionAggregateResult> {
	const segments = segmentTextForDetection(text, driver.segmentMaxChars);
	if (segments.length === 0) {
		throw new Error('EMPTY_CONTENT');
	}

	const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
	const detectionResults = await mapWithConcurrency(segments, concurrency, async (seg) => {
		const result = await driver.detectSegment(seg.text, cfg, { fetchImpl: options?.fetchImpl });
		return {
			index: seg.index,
			chars: seg.charCount,
			score: result.score,
			excerpt: excerpt(seg.text),
		};
	});

	const totalChars = detectionResults.reduce((sum, s) => sum + s.chars, 0);
	const weightedSum = detectionResults.reduce((sum, s) => sum + s.score * s.chars, 0);
	const overallScore = totalChars > 0 ? Math.round(weightedSum / totalChars) : 0;

	return {
		overallScore: Math.max(0, Math.min(100, overallScore)),
		totalChars,
		segments: detectionResults.sort((a, b) => a.index - b.index),
	};
}
