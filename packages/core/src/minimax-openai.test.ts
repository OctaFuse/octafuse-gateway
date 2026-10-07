import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	MiniMaxOpenAiClientError,
	buildMiniMaxImageBodyFromOpenAi,
	buildMiniMaxT2aBodyFromOpenAi,
	fillMiniMaxSpeechDefaults,
	miniMaxImageResponseToOpenAi,
} from './minimax-openai';

describe('MiniMax OpenAI speech mapping', () => {
	it('builds a non-stream t2a body from OpenAI speech fields', () => {
		assert.deepEqual(
			buildMiniMaxT2aBodyFromOpenAi({
				model: 'speech-2.8-turbo',
				text: '你好',
				voiceId: 'male-qn-qingse',
				responseFormat: 'MP3',
				speed: 1,
				stream: false,
			}),
			{
				model: 'speech-2.8-turbo',
				text: '你好',
				stream: false,
				output_format: 'hex',
				voice_setting: { voice_id: 'male-qn-qingse', speed: 1 },
				audio_setting: { format: 'mp3', channel: 1 },
			},
		);
	});

	it('fills vol, pitch, sample rate, and mp3 bitrate only when missing', () => {
		const filled = fillMiniMaxSpeechDefaults(
			buildMiniMaxT2aBodyFromOpenAi({
				model: 'speech-2.8-turbo',
				text: '你好',
				voiceId: 'male-qn-qingse',
				responseFormat: 'mp3',
				speed: 1,
				stream: false,
			}),
		);
		assert.deepEqual(filled.voice_setting, { voice_id: 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 });
		assert.deepEqual(filled.audio_setting, {
			format: 'mp3',
			channel: 1,
			sample_rate: 32000,
			bitrate: 128000,
		});
		const kept = fillMiniMaxSpeechDefaults({
			voice_setting: { voice_id: 'male-qn-qingse', speed: 1, vol: 2, pitch: 3 },
			audio_setting: { format: 'mp3', sample_rate: 16000, bitrate: 64000, channel: 1 },
		});
		assert.equal((kept.voice_setting as { vol: number }).vol, 2);
		assert.equal((kept.audio_setting as { sample_rate: number }).sample_rate, 16000);
		assert.equal((kept.audio_setting as { bitrate: number }).bitrate, 64000);
	});

	it('asks MiniMax not to repeat the full audio on the last SSE frame', () => {
		const body = buildMiniMaxT2aBodyFromOpenAi({
			model: 'speech-2.8-turbo',
			text: '你好',
			voiceId: 'male-qn-qingse',
			responseFormat: 'wav',
			speed: 1,
			stream: true,
		});
		assert.equal(body.stream, true);
		assert.deepEqual(body.stream_options, { exclude_aggregated_audio: true });
		assert.equal((body.audio_setting as { bitrate?: number }).bitrate, undefined);
	});

	it('rejects formats, speeds, and instructions MiniMax cannot honor', () => {
		assert.throws(
			() =>
				buildMiniMaxT2aBodyFromOpenAi({
					model: 'speech-2.8-turbo',
					text: '你好',
					voiceId: 'male-qn-qingse',
					responseFormat: 'opus',
					speed: 1,
					stream: false,
				}),
			MiniMaxOpenAiClientError,
		);
		assert.throws(
			() =>
				buildMiniMaxT2aBodyFromOpenAi({
					model: 'speech-2.8-turbo',
					text: '你好',
					voiceId: 'male-qn-qingse',
					responseFormat: 'mp3',
					speed: 0.25,
					stream: false,
				}),
			MiniMaxOpenAiClientError,
		);
		assert.throws(
			() =>
				buildMiniMaxT2aBodyFromOpenAi({
					model: 'speech-2.8-turbo',
					text: '你好',
					voiceId: 'male-qn-qingse',
					responseFormat: 'mp3',
					speed: 1,
					stream: false,
					instructions: 'whisper',
				}),
			MiniMaxOpenAiClientError,
		);
	});
});

describe('MiniMax OpenAI image mapping', () => {
	it('forwards aspect_ratio and drops OpenAI size', () => {
		assert.deepEqual(
			buildMiniMaxImageBodyFromOpenAi('image-01', {
				prompt: 'a red lantern',
				n: 1,
				size: '1024x1024',
				quality: 'low',
				background: 'transparent',
				style: 'vivid',
				response_format: 'b64_json',
				aspect_ratio: '16:9',
				width: 1024,
				height: 576,
			}),
			{
				model: 'image-01',
				prompt: 'a red lantern',
				aspect_ratio: '16:9',
				width: 1024,
				height: 576,
				response_format: 'base64',
				n: 1,
			},
		);
	});

	it('omits aspect_ratio when the client does not send one', () => {
		const body = buildMiniMaxImageBodyFromOpenAi('image-01-live', {
			prompt: 'a cat',
			size: '1024x1024',
			style: '吉卜力',
		});
		assert.equal(body.aspect_ratio, undefined);
		assert.equal(body.size, undefined);
		assert.equal(body.style, '吉卜力');
		assert.equal(body.response_format, 'url');
	});

	it('rewrites MiniMax image JSON into the OpenAI data array', () => {
		assert.deepEqual(
			miniMaxImageResponseToOpenAi(
				{ data: { image_urls: [' https://cdn.example/a.jpg '] } },
				'url',
			).data,
			[{ url: 'https://cdn.example/a.jpg' }],
		);
		assert.deepEqual(
			miniMaxImageResponseToOpenAi(
				{ data: { image_base64: ['data:image/jpeg;base64,aGVsbG8='] } },
				'b64_json',
			).data,
			[{ b64_json: 'aGVsbG8=' }],
		);
	});
});
