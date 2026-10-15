import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	parseInvokeKindParam,
	parseKindFilterParam,
	resolveOpenaiUpstreamCapability,
	resolveProxyPathForModelInvoke,
	resolveRequestOperation,
} from './invoke-kind';

describe('invoke-kind asr / tts', () => {
	it('keeps legacy ?kind=audio working by mapping it to asr', () => {
		assert.equal(parseKindFilterParam('audio'), 'asr');
		assert.equal(parseKindFilterParam('TTS'), 'tts');
		assert.equal(parseInvokeKindParam('audio'), 'asr');
		assert.equal(parseInvokeKindParam('tts'), 'tts');
	});

	it('derives operations and paths from the split kinds', () => {
		assert.equal(resolveRequestOperation({ kind: 'asr', protocol: 'openai' }), 'audio.transcriptions');
		assert.equal(resolveRequestOperation({ kind: 'tts', protocol: 'openai' }), 'audio.speech');
		assert.equal(resolveRequestOperation({ kind: 'tts', protocol: 'dashscope' }), 'audio.speech.realtime.inference');
		assert.equal(resolveOpenaiUpstreamCapability({ kind: 'asr' }), 'audio.transcriptions');
		assert.equal(resolveOpenaiUpstreamCapability({ kind: 'tts' }), 'audio.speech');
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'asr', protocol: 'openai' }), '/v1/audio/transcriptions');
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'tts', protocol: 'openai' }), '/v1/audio/speech');
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'tts', protocol: 'minimax' }), '/v1/minimax/t2a_v2');
	});
});

describe('invoke-kind embedding', () => {
	it('resolves OpenAI embeddings path', () => {
		assert.equal(resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'openai' }), '/v1/embeddings');
	});

	it('resolves Gemini embed paths', () => {
		assert.equal(
			resolveProxyPathForModelInvoke({ kind: 'embedding', protocol: 'gemini', geminiModelSegment: 'gemini-embedding-2' }),
			'/v1beta/models/gemini-embedding-2:embedContent',
		);
		assert.equal(
			resolveProxyPathForModelInvoke({
				kind: 'embedding',
				protocol: 'gemini',
				geminiModelSegment: 'gemini-embedding-2',
				geminiEmbedAction: 'batchEmbedContents',
			}),
			'/v1beta/models/gemini-embedding-2:batchEmbedContents',
		);
	});
});
