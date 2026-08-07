import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildDashScopeRealtimeTtsTemplate,
	buildDashScopeSpeechBodyTemplate,
	dashScopeRealtimeAudioContentType,
} from './dashscope-realtime-client';

describe('DashScope realtime TTS client messages', () => {
	it('uses the inference task template and keeps editor text in payload.input', () => {
		const body = JSON.parse(buildDashScopeRealtimeTtsTemplate()) as {
			header: { action: string; streaming: string };
			payload: {
				task: string;
				function: string;
				input: { text: string };
			};
		};
		assert.equal(body.header.action, 'run-task');
		assert.equal(body.header.streaming, 'duplex');
		assert.equal(body.payload.task, 'tts');
		assert.equal(body.payload.function, 'SpeechSynthesizer');
		assert.equal(body.payload.input.text.length > 0, true);
	});

	it('uses a CosyVoice system voice for CosyVoice provider models', () => {
		const body = JSON.parse(buildDashScopeRealtimeTtsTemplate('cosyvoice-v2')) as {
			payload: { parameters: { voice: string } };
		};
		assert.equal(body.payload.parameters.voice, 'longanling');
		const httpBody = JSON.parse(buildDashScopeSpeechBodyTemplate('cosyvoice-v2')) as { voice: string };
		assert.equal(httpBody.voice, 'longanling');
	});

	it('maps the upstream format to a browser audio content type', () => {
		const base = JSON.parse(buildDashScopeRealtimeTtsTemplate()) as {
			payload: { parameters: { format: string } };
		};
		assert.equal(dashScopeRealtimeAudioContentType(JSON.stringify(base)), 'audio/mpeg');
		base.payload.parameters.format = 'wav';
		assert.equal(dashScopeRealtimeAudioContentType(JSON.stringify(base)), 'audio/wav');
		base.payload.parameters.format = 'pcm';
		assert.equal(dashScopeRealtimeAudioContentType(JSON.stringify(base)), 'audio/pcm');
	});
});
