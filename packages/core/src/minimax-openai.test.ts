import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	MiniMaxOpenAiClientError,
	buildMiniMaxImageBodyFromOpenAi,
	buildMiniMaxT2aBodyFromOpenAi,
	miniMaxAspectRatioFromOpenAiSize,
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
				voice_setting: { voice_id: 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 },
				audio_setting: { format: 'mp3', sample_rate: 32000, channel: 1, bitrate: 128000 },
			},
		);
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
	it('maps pixel size to the nearest official aspect ratio and drops OpenAI-only fields', () => {
		assert.equal(miniMaxAspectRatioFromOpenAiSize('1024x1024'), '1:1');
		assert.equal(miniMaxAspectRatioFromOpenAiSize('1792x1024'), '16:9');
		assert.equal(miniMaxAspectRatioFromOpenAiSize('1024x1792'), '9:16');
		assert.deepEqual(
			buildMiniMaxImageBodyFromOpenAi('image-01', {
				prompt: 'a red lantern',
				n: 1,
				size: '1024x1024',
				quality: 'low',
				background: 'transparent',
				style: 'vivid',
				response_format: 'b64_json',
			}),
			{
				model: 'image-01',
				prompt: 'a red lantern',
				aspect_ratio: '1:1',
				response_format: 'base64',
				n: 1,
			},
		);
	});

	it('keeps an explicit aspect ratio and live style', () => {
		const body = buildMiniMaxImageBodyFromOpenAi('image-01-live', {
			prompt: 'a cat',
			aspect_ratio: '3:4',
			size: '1024x1024',
			style: '吉卜力',
		});
		assert.equal(body.aspect_ratio, '3:4');
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
