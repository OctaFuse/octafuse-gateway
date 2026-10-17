import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	elevenLabsErrorHttpStatus,
	elevenLabsTtsVariantSuffix,
	elevenLabsWordsDurationSeconds,
	elevenLabsWordsToSegments,
	isValidElevenLabsVoiceId,
	readElevenLabsAudioDuration,
	readElevenLabsCharacterCount,
	readElevenLabsError,
	readElevenLabsSttText,
	readElevenLabsSttWords,
} from './elevenlabs-native';

const word = (text: string, start: number, end: number, speaker_id?: string) => ({
	text,
	type: 'word',
	start,
	end,
	...(speaker_id ? { speaker_id } : {}),
});
const space = (start: number, end: number) => ({ text: ' ', type: 'spacing', start, end });

describe('elevenlabs error handling', () => {
	it('reads structured, string and validation details', () => {
		assert.deepEqual(readElevenLabsError({ detail: { status: 'quota_exceeded', message: 'out' } }), {
			status: 'quota_exceeded',
			message: 'out',
		});
		assert.deepEqual(readElevenLabsError({ detail: 'bad' }), { status: null, message: 'bad' });
		assert.deepEqual(readElevenLabsError({ detail: [{ msg: 'a' }, { msg: 'b' }] }), {
			status: null,
			message: 'a; b',
		});
		assert.deepEqual(readElevenLabsError(null), { status: null, message: null });
	});

	it('rewrites quota to 402 and concurrency to 429, keeps the rest', () => {
		assert.equal(elevenLabsErrorHttpStatus(401, 'quota_exceeded'), 402);
		assert.equal(elevenLabsErrorHttpStatus(401, 'invalid_api_key'), 401);
		assert.equal(elevenLabsErrorHttpStatus(429, 'too_many_concurrent_requests'), 429);
		assert.equal(elevenLabsErrorHttpStatus(503, 'system_busy'), 429);
		assert.equal(elevenLabsErrorHttpStatus(500, null), 500);
		assert.equal(elevenLabsErrorHttpStatus(200, 'quota_exceeded'), 200);
	});
});

describe('elevenlabs tts helpers', () => {
	it('maps variants to upstream path suffixes', () => {
		assert.equal(elevenLabsTtsVariantSuffix('speech'), '');
		assert.equal(elevenLabsTtsVariantSuffix('stream'), '/stream');
		assert.equal(elevenLabsTtsVariantSuffix('timestamps'), '/with-timestamps');
		assert.equal(elevenLabsTtsVariantSuffix('stream-timestamps'), '/stream/with-timestamps');
	});

	it('validates voice ids', () => {
		assert.equal(isValidElevenLabsVoiceId('JBFqnCBsd6RMkjVDRZzb'), true);
		assert.equal(isValidElevenLabsVoiceId('a/../b'), false);
		assert.equal(isValidElevenLabsVoiceId(''), false);
		assert.equal(isValidElevenLabsVoiceId('a?b'), false);
	});

	it('reads x-character-count', () => {
		assert.equal(readElevenLabsCharacterCount(new Headers({ 'x-character-count': '42' })), 42);
		assert.equal(readElevenLabsCharacterCount(new Headers()), null);
		assert.equal(readElevenLabsCharacterCount(new Headers({ 'x-character-count': 'x' })), null);
	});
});

describe('elevenlabs stt helpers', () => {
	it('reads duration and words', () => {
		assert.equal(readElevenLabsAudioDuration({ audio_duration_secs: 3.5 }), 3.5);
		assert.equal(readElevenLabsAudioDuration({}), null);
		const words = readElevenLabsSttWords({ words: [word('Hi', 0, 0.4), space(0.4, 0.5)] });
		assert.equal(words.length, 2);
		assert.equal(elevenLabsWordsDurationSeconds(words), 0.5);
		assert.equal(readElevenLabsSttText({ text: 'Hi' }), 'Hi');
	});

	it('merges multichannel transcripts by start time', () => {
		const body = {
			transcripts: [
				{ text: 'a', words: [word('a', 2, 3)] },
				{ text: 'b', words: [word('b', 0, 1)] },
			],
		};
		assert.deepEqual(
			readElevenLabsSttWords(body).map((w) => w.text),
			['b', 'a'],
		);
		assert.equal(readElevenLabsSttText(body), 'a\nb');
	});

	it('splits segments on punctuation, speaker change, gaps and length', () => {
		const words = readElevenLabsSttWords({
			words: [
				word('Hello', 0, 0.5, 'speaker_0'),
				space(0.5, 0.6),
				word('world.', 0.6, 1.2, 'speaker_0'),
				space(1.2, 1.3),
				word('Hi', 1.3, 1.6, 'speaker_1'),
				space(1.6, 1.7),
				word('there', 1.7, 2, 'speaker_0'),
				word('late', 5, 5.5, 'speaker_0'),
			],
		});
		const segments = elevenLabsWordsToSegments(words);
		assert.deepEqual(
			segments.map((s) => [s.text, s.speaker]),
			[
				['Hello world.', 'speaker_0'],
				['Hi', 'speaker_1'],
				['there', 'speaker_0'],
				['late', 'speaker_0'],
			],
		);
		assert.equal(segments[0]!.start, 0);
		assert.equal(segments[0]!.end, 1.2);
	});

	it('cuts segments that run longer than 15 seconds', () => {
		const words = Array.from({ length: 20 }, (_, i) => word(`w${i}`, i, i + 0.9));
		const segments = elevenLabsWordsToSegments(words);
		assert.ok(segments.length >= 2);
		assert.ok(segments.every((s) => s.end - s.start <= 15));
	});
});
