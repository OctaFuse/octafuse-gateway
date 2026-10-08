import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	countMiniMaxImages,
	decodeMiniMaxHexAudio,
	extractMiniMaxSpeechAudio,
	miniMaxAudioContentType,
	miniMaxBaseRespHttpStatus,
	readMiniMaxBaseResp,
	readMiniMaxUsageCharacters,
} from './minimax-native';

describe('MiniMax native response helpers', () => {
	it('reads base_resp and maps business codes onto HTTP statuses', () => {
		assert.deepEqual(
			readMiniMaxBaseResp({ base_resp: { status_code: 1004, status_msg: 'auth' } }),
			{ statusCode: 1004, statusMsg: 'auth' },
		);
		assert.equal(readMiniMaxBaseResp({ data: {} }), null);
		assert.equal(miniMaxBaseRespHttpStatus(0), 200);
		assert.equal(miniMaxBaseRespHttpStatus(1002), 429);
		assert.equal(miniMaxBaseRespHttpStatus(1039), 429);
		assert.equal(miniMaxBaseRespHttpStatus(1004), 401);
		assert.equal(miniMaxBaseRespHttpStatus(2049), 401);
		assert.equal(miniMaxBaseRespHttpStatus(1008), 402);
		assert.equal(miniMaxBaseRespHttpStatus(2013), 400);
		assert.equal(miniMaxBaseRespHttpStatus(1026), 400);
		assert.equal(miniMaxBaseRespHttpStatus(1042), 400);
		assert.equal(miniMaxBaseRespHttpStatus(1001), 504);
		assert.equal(miniMaxBaseRespHttpStatus(1000), 502);
	});

	it('reads billed characters and image counts', () => {
		assert.equal(readMiniMaxUsageCharacters({ extra_info: { usage_characters: 26 } }), 26);
		assert.equal(readMiniMaxUsageCharacters({ extra_info: { usage_characters: '12.9' } }), 12);
		assert.equal(readMiniMaxUsageCharacters({}), null);
		assert.equal(
			countMiniMaxImages({
				metadata: { success_count: '3' },
				data: { image_urls: ['a'] },
			}),
			3,
		);
		assert.equal(countMiniMaxImages({ data: { image_base64: ['abc', ' '] } }), 1);
		assert.equal(countMiniMaxImages({}), 0);
	});

	it('decodes hex audio and maps formats to content types', () => {
		assert.deepEqual([...decodeMiniMaxHexAudio('4869')], [0x48, 0x69]);
		assert.throws(() => decodeMiniMaxHexAudio('abc'), /invalid hex/);
		assert.equal(miniMaxAudioContentType('mp3'), 'audio/mpeg');
		assert.equal(miniMaxAudioContentType('flac'), 'audio/flac');
		assert.equal(miniMaxAudioContentType('pcmu_wav'), 'audio/wav');
		assert.equal(miniMaxAudioContentType(null), 'audio/mpeg');
	});

	it('prefers the last complete speech frame and otherwise concatenates chunks', () => {
		assert.deepEqual(
			extractMiniMaxSpeechAudio(
				JSON.stringify({
					data: { audio: '4869', status: 2 },
					extra_info: { audio_format: 'wav' },
				}),
			),
			{ hex: '4869', format: 'wav' },
		);
		const sse = [
			'data: {"data":{"audio":"aa","status":1}}',
			'',
			'data: {"data":{"audio":"4869","status":2},"extra_info":{"audio_format":"mp3"}}',
			'',
		].join('\n');
		assert.deepEqual(extractMiniMaxSpeechAudio(sse), { hex: '4869', format: 'mp3' });
		const chunksOnly = [
			'data: {"data":{"audio":"48","status":1}}',
			'',
			'data: {"data":{"audio":"69","status":1}}',
			'',
		].join('\n');
		assert.deepEqual(extractMiniMaxSpeechAudio(chunksOnly), { hex: '4869', format: null });
	});
});
