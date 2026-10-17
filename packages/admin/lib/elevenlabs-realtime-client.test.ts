import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildElevenLabsRealtimeTemplate,
	defaultAudioInputModeForElevenLabsOperation,
	elevenLabsRealtimeAudioBlob,
	elevenLabsRealtimeOutputFormat,
	extractElevenLabsRealtimeTranscript,
	isElevenLabsRealtimeOperation,
	prepareElevenLabsRealtimeRequest,
	summarizeElevenLabsRealtimeMessage,
} from './elevenlabs-realtime-client';

describe('ElevenLabs realtime client helpers', () => {
	it('defaults realtime ASR to the microphone and TTS to file', () => {
		assert.equal(defaultAudioInputModeForElevenLabsOperation('audio.transcriptions.realtime'), 'microphone');
		assert.equal(defaultAudioInputModeForElevenLabsOperation('audio.speech.realtime'), 'file');
		assert.equal(defaultAudioInputModeForElevenLabsOperation(null), 'file');
		assert.equal(isElevenLabsRealtimeOperation('audio.speech'), false);
	});

	it('builds parseable templates for both operations', () => {
		for (const operation of ['audio.transcriptions.realtime', 'audio.speech.realtime']) {
			const parsed = JSON.parse(buildElevenLabsRealtimeTemplate(operation)) as Record<string, unknown>;
			assert.equal(typeof parsed, 'object');
		}
	});

	it('forces pcm_16000 and drops routing fields for realtime ASR', () => {
		const prepared = prepareElevenLabsRealtimeRequest('audio.transcriptions.realtime', {
			model_id: 'ignored',
			audio_format: 'ulaw_8000',
			commit_strategy: 'vad',
			language_code: '',
			include_timestamps: true,
		});
		assert.deepEqual(prepared.query, {
			commit_strategy: 'vad',
			include_timestamps: 'true',
			audio_format: 'pcm_16000',
		});
		assert.equal(prepared.voiceId, undefined);
	});

	it('splits realtime TTS body into path, query and first frame', () => {
		const prepared = prepareElevenLabsRealtimeRequest('audio.speech.realtime', {
			voice_id: 'JBFqnCBsd6RMkjVDRZzb',
			model_id: 'ignored',
			output_format: 'pcm_16000',
			text: 'hello',
			voice_settings: { stability: 0.5 },
		});
		assert.equal(prepared.voiceId, 'JBFqnCBsd6RMkjVDRZzb');
		assert.deepEqual(prepared.query, { output_format: 'pcm_16000' });
		assert.deepEqual(prepared.initFrame, { text: ' ', voice_settings: { stability: 0.5 } });
		assert.equal(prepared.text, 'hello');
		assert.equal(elevenLabsRealtimeOutputFormat(prepared), 'pcm_16000');
	});

	it('rejects realtime TTS without voice_id or text', () => {
		assert.throws(() => prepareElevenLabsRealtimeRequest('audio.speech.realtime', { text: 'hi' }));
		assert.throws(() =>
			prepareElevenLabsRealtimeRequest('audio.speech.realtime', { voice_id: 'JBFqnCBsd6RMkjVDRZzb', text: ' ' }),
		);
	});

	it('wraps pcm output in a WAV container and tags other formats', async () => {
		const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
		const wav = elevenLabsRealtimeAudioBlob([pcm], 'pcm_16000');
		assert.equal(wav.type, 'audio/wav');
		assert.equal(wav.size, 44 + 4);
		const head = new Uint8Array(await wav.arrayBuffer());
		assert.equal(String.fromCharCode(...head.slice(0, 4)), 'RIFF');
		assert.equal(elevenLabsRealtimeAudioBlob([pcm], 'mp3_44100_128').type, 'audio/mpeg');
	});

	it('folds base64 audio frames in the raw view', () => {
		const frame = JSON.stringify({ audio: 'AAAA', isFinal: null });
		assert.match(summarizeElevenLabsRealtimeMessage(frame), /\[base64 3 bytes\]/);
		const other = JSON.stringify({ message_type: 'session_started' });
		assert.equal(summarizeElevenLabsRealtimeMessage(other), other);
	});

	it('reconstructs committed lines and the trailing partial transcript', () => {
		const lines = [
			{ message_type: 'session_started' },
			{ message_type: 'partial_transcript', text: 'hel' },
			{ message_type: 'committed_transcript', text: 'hello' },
			{ message_type: 'committed_transcript_with_timestamps', text: 'hello' },
			{ message_type: 'partial_transcript', text: 'wor' },
		].map((item) => JSON.stringify(item));
		assert.equal(extractElevenLabsRealtimeTranscript(lines.join('\n')), 'hello\nwor …');
	});
});
