import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	ElevenLabsOpenAiClientError,
	assertElevenLabsAsrNotWebhook,
	buildElevenLabsTtsRequestFromOpenAi,
	elevenLabsTranscriptToClient,
	resolveElevenLabsAsrMapping,
	splitElevenLabsTtsQuery,
} from './elevenlabs-openai';

const base = {
	model: 'eleven_multilingual_v2',
	text: 'hello',
	voiceId: 'JBFqnCBsd6RMkjVDRZzb',
	responseFormat: 'mp3',
	speed: 1,
	stream: false,
};

describe('buildElevenLabsTtsRequestFromOpenAi', () => {
	it('maps the default request', () => {
		const built = buildElevenLabsTtsRequestFromOpenAi(base);
		assert.equal(built.voiceId, 'JBFqnCBsd6RMkjVDRZzb');
		assert.equal(built.pathSuffix, '');
		assert.deepEqual(built.query, { output_format: 'mp3_44100_128' });
		assert.deepEqual(built.body, { text: 'hello', model_id: 'eleven_multilingual_v2' });
		assert.equal(built.contentType, 'audio/mpeg');
	});

	it('maps formats, stream and speed', () => {
		const built = buildElevenLabsTtsRequestFromOpenAi({
			...base,
			responseFormat: 'pcm',
			speed: 1.1,
			stream: true,
		});
		assert.equal(built.pathSuffix, '/stream');
		assert.equal(built.query.output_format, 'pcm_24000');
		assert.deepEqual(built.body.voice_settings, { speed: 1.1 });
		assert.equal(buildElevenLabsTtsRequestFromOpenAi({ ...base, responseFormat: 'wav' }).query.output_format, 'wav_24000');
		assert.equal(buildElevenLabsTtsRequestFromOpenAi({ ...base, responseFormat: 'opus' }).query.output_format, 'opus_48000_128');
	});

	it('rejects unsupported inputs with client errors', () => {
		for (const patch of [
			{ responseFormat: 'aac' },
			{ responseFormat: 'flac' },
			{ speed: 2 },
			{ speed: 0.5 },
			{ instructions: 'calm' },
			{ text: '  ' },
			{ voiceId: '' },
			{ voiceId: '../x' },
		]) {
			assert.throws(
				() => buildElevenLabsTtsRequestFromOpenAi({ ...base, ...patch }),
				ElevenLabsOpenAiClientError,
				JSON.stringify(patch),
			);
		}
	});
});

describe('splitElevenLabsTtsQuery', () => {
	it('moves logging and latency fields to query', () => {
		const out = splitElevenLabsTtsQuery({
			text: 'a',
			enable_logging: false,
			optimize_streaming_latency: 3,
			seed: 1,
		});
		assert.deepEqual(out.query, { enable_logging: 'false', optimize_streaming_latency: '3' });
		assert.deepEqual(out.body, { text: 'a', seed: 1 });
	});
});

const transcript = {
	language_code: 'eng',
	text: 'Hello world. Bye',
	audio_duration_secs: 4,
	words: [
		{ text: 'Hello', type: 'word', start: 0, end: 0.5, speaker_id: 'speaker_0' },
		{ text: ' ', type: 'spacing', start: 0.5, end: 0.6 },
		{ text: 'world.', type: 'word', start: 0.6, end: 1.2, speaker_id: 'speaker_0' },
		{ text: ' ', type: 'spacing', start: 1.2, end: 1.3 },
		{ text: 'Bye', type: 'word', start: 1.3, end: 1.6, speaker_id: 'speaker_1' },
	],
};

describe('ASR mapping', () => {
	it('maps client formats', () => {
		assert.equal(resolveElevenLabsAsrMapping('text').clientShape, 'text');
		assert.equal(resolveElevenLabsAsrMapping(undefined).clientShape, 'json');
		assert.equal(resolveElevenLabsAsrMapping('diarized_json').diarize, true);
		assert.equal(resolveElevenLabsAsrMapping('srt').diarize, false);
		assert.equal(resolveElevenLabsAsrMapping('vtt').timestampsGranularity, 'word');
	});

	it('rejects webhook mode', () => {
		assert.throws(() => assertElevenLabsAsrNotWebhook('true'), ElevenLabsOpenAiClientError);
		assert.throws(() => assertElevenLabsAsrNotWebhook(true), ElevenLabsOpenAiClientError);
		assert.doesNotThrow(() => assertElevenLabsAsrNotWebhook('false'));
		assert.doesNotThrow(() => assertElevenLabsAsrNotWebhook(undefined));
	});

	it('renders each client shape', () => {
		assert.equal(elevenLabsTranscriptToClient(transcript, 'text'), 'Hello world. Bye');
		assert.deepEqual(elevenLabsTranscriptToClient(transcript, 'json'), { text: 'Hello world. Bye' });
		const verbose = elevenLabsTranscriptToClient(transcript, 'verbose_json') as Record<string, unknown>;
		assert.equal(verbose.language, 'eng');
		assert.equal(verbose.duration, 4);
		assert.equal((verbose.segments as unknown[]).length, 2);
		assert.equal((verbose.words as unknown[]).length, 3);
		const diarized = elevenLabsTranscriptToClient(transcript, 'diarized_json') as {
			segments: Array<{ speaker: string; text: string }>;
		};
		assert.deepEqual(
			diarized.segments.map((s) => [s.speaker, s.text]),
			[
				['speaker_0', 'Hello world.'],
				['speaker_1', 'Bye'],
			],
		);
		const srt = elevenLabsTranscriptToClient(transcript, 'srt') as string;
		assert.match(srt, /00:00:00,000 --> 00:00:01,200/);
		const vtt = elevenLabsTranscriptToClient(transcript, 'vtt') as string;
		assert.ok(vtt.startsWith('WEBVTT'));
	});
});
