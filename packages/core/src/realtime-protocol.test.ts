import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildDashScopeRealtimeAuthProtocol,
	isDashScopeRealtimePath,
	isElevenLabsRealtimePath,
	isElevenLabsSttRealtimePath,
	isRealtimeUpgradePath,
	parseElevenLabsTtsRealtimePath,
	parseDashScopeRealtimeAuthProtocol,
	pickDashScopeRealtimeSubprotocol,
} from './realtime-protocol';

describe('DashScope realtime browser auth protocol', () => {
	it('carries the API key in a negotiated subprotocol token', () => {
		const protocol = buildDashScopeRealtimeAuthProtocol('sk-test-key');
		assert.deepEqual(parseDashScopeRealtimeAuthProtocol(protocol), {
			apiKey: 'sk-test-key',
			protocol,
		});
	});

	it('selects the gateway token from a list of offered protocols', () => {
		assert.deepEqual(
			parseDashScopeRealtimeAuthProtocol(
				'chat, octafuse-api-key.sk-test-key, audio'
			),
			{ apiKey: 'sk-test-key', protocol: 'octafuse-api-key.sk-test-key' }
		);
	});

	it('rejects an absent or empty token', () => {
		assert.equal(parseDashScopeRealtimeAuthProtocol('chat, audio'), null);
		assert.equal(parseDashScopeRealtimeAuthProtocol('octafuse-api-key.'), null);
	});

	it('prefers the gateway auth subprotocol when several are offered', () => {
		assert.equal(
			pickDashScopeRealtimeSubprotocol(['chat', 'octafuse-api-key.sk-test-key', 'audio']),
			'octafuse-api-key.sk-test-key'
		);
		assert.equal(pickDashScopeRealtimeSubprotocol(['chat']), 'chat');
		assert.equal(pickDashScopeRealtimeSubprotocol([]), false);
	});
});

describe('DashScope realtime entry paths', () => {
	it('matches both official-style entries and the legacy alias', () => {
		assert.equal(isDashScopeRealtimePath('/dashscope/api-ws/v1/inference'), true);
		assert.equal(isDashScopeRealtimePath('/dashscope/api-ws/v1/realtime'), true);
		assert.equal(isDashScopeRealtimePath('/dashscope/api-ws/v1/realtime/'), true);
		assert.equal(isDashScopeRealtimePath('/v1/dashscope/realtime'), true);
	});

	it('does not match unrelated paths', () => {
		assert.equal(isDashScopeRealtimePath('/v1/chat/completions'), false);
		assert.equal(isDashScopeRealtimePath('/dashscope/api/v1/tasks'), false);
		assert.equal(isDashScopeRealtimePath('/dashscope/api-ws/v1/other'), false);
	});
});

describe('ElevenLabs realtime entry paths', () => {
	it('parses the TTS stream-input path and decodes voice_id', () => {
		assert.deepEqual(
			parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream-input'),
			{ voiceId: 'JBFqnCBsd6RMkjVDRZzb' }
		);
		assert.deepEqual(
			parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/a%20b/stream-input/'),
			{ voiceId: 'a b' }
		);
	});

	it('does not treat HTTP TTS variants or multi-stream-input as realtime', () => {
		assert.equal(parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/v1'), null);
		assert.equal(parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/v1/stream'), null);
		assert.equal(parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/v1/multi-stream-input'), null);
		assert.equal(parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech//stream-input'), null);
		assert.equal(parseElevenLabsTtsRealtimePath('/elevenlabs/v1/text-to-speech/%E0%A4%A/stream-input'), null);
	});

	it('matches the realtime STT path only', () => {
		assert.equal(isElevenLabsSttRealtimePath('/elevenlabs/v1/speech-to-text/realtime'), true);
		assert.equal(isElevenLabsSttRealtimePath('/elevenlabs/v1/speech-to-text'), false);
		assert.equal(isElevenLabsRealtimePath('/elevenlabs/v1/speech-to-text/realtime'), true);
	});

	it('isRealtimeUpgradePath covers both vendors', () => {
		assert.equal(isRealtimeUpgradePath('/dashscope/api-ws/v1/inference'), true);
		assert.equal(isRealtimeUpgradePath('/elevenlabs/v1/text-to-speech/v1/stream-input'), true);
		assert.equal(isRealtimeUpgradePath('/v1/chat/completions'), false);
	});
});
