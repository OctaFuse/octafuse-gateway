import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildMiniMaxAsrHeaders,
	formatSubtitleTimestamp,
	readMiniMaxAsrSegments,
	renderSegmentsAsSrt,
	renderSegmentsAsVtt,
	resolveMiniMaxAsrUpstreamFormat,
} from './minimax-asr';

describe('resolveMiniMaxAsrUpstreamFormat', () => {
	it('asks json for text and json, and verbose_json when timestamps are required', () => {
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('text'), {
			upstreamFormat: 'json',
			clientShape: 'text',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('json'), {
			upstreamFormat: 'json',
			clientShape: 'json',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat(undefined), {
			upstreamFormat: 'json',
			clientShape: 'json',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('verbose_json'), {
			upstreamFormat: 'verbose_json',
			clientShape: 'verbose_json',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('diarized_json'), {
			upstreamFormat: 'verbose_json',
			clientShape: 'verbose_json',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('srt'), {
			upstreamFormat: 'verbose_json',
			clientShape: 'srt',
		});
		assert.deepEqual(resolveMiniMaxAsrUpstreamFormat('vtt'), {
			upstreamFormat: 'verbose_json',
			clientShape: 'vtt',
		});
	});
});

describe('buildMiniMaxAsrHeaders', () => {
	it('puts a trimmed language into the language header', () => {
		assert.deepEqual(buildMiniMaxAsrHeaders({ language: ' zh ' }), { language: 'zh' });
		assert.deepEqual(buildMiniMaxAsrHeaders({ language: '' }), {});
		assert.deepEqual(buildMiniMaxAsrHeaders({}), {});
	});
});

describe('MiniMax subtitle rendering', () => {
	const segments = readMiniMaxAsrSegments({
		segments: [
			{ start: 0, end: 1.25, text: '你好', speaker: '1' },
			{ start: 1.25, end: 2, text: 'hello' },
		],
	});

	it('reads numeric segment bounds and optional speakers', () => {
		assert.deepEqual(segments, [
			{ start: 0, end: 1.25, text: '你好', speaker: '1' },
			{ start: 1.25, end: 2, text: 'hello' },
		]);
	});

	it('formats SRT with a comma millisecond separator', () => {
		assert.equal(formatSubtitleTimestamp(1.25, ','), '00:00:01,250');
		assert.equal(
			renderSegmentsAsSrt(segments),
			'1\n00:00:00,000 --> 00:00:01,250\n[1] 你好\n\n2\n00:00:01,250 --> 00:00:02,000\nhello\n'
		);
	});

	it('formats WebVTT with a dot millisecond separator', () => {
		assert.equal(
			renderSegmentsAsVtt(segments),
			'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\n[1] 你好\n\n2\n00:00:01.250 --> 00:00:02.000\nhello\n'
		);
		assert.equal(renderSegmentsAsVtt([]), 'WEBVTT\n');
		assert.equal(renderSegmentsAsSrt([]), '');
	});
});
