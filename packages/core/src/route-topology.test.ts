import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	GEMINI_GENERATE_OPERATION,
	canonicalizeRequestOperation,
	effectiveUpstreamOperation,
	isDashScopeRealtimeAsrModelOperationCompatible,
	isRouteAdapterCompatible,
	isRequestOperationForProtocol,
	normalizeRouteOperation,
	requestOperationAliasRank,
} from './route-topology';

describe('route topology operations', () => {
	it('validates operations within their public protocol', () => {
		assert.equal(isRequestOperationForProtocol('openai', 'chat'), true);
		assert.equal(isRequestOperationForProtocol('openai', 'responses'), true);
		assert.equal(isRequestOperationForProtocol('openai', 'audio.speech'), true);
		assert.equal(isRequestOperationForProtocol('anthropic', 'messages'), true);
		assert.equal(isRequestOperationForProtocol('gemini', GEMINI_GENERATE_OPERATION), true);
		assert.equal(isRequestOperationForProtocol('gemini', 'generateContent'), false);
		assert.equal(isRequestOperationForProtocol('gemini', 'streamGenerateContent'), false);
		assert.equal(isRequestOperationForProtocol('anthropic', 'chat'), false);
		assert.equal(
			isRequestOperationForProtocol('dashscope', 'audio.transcriptions.async'),
			true
		);
	});

	it('canonicalizes legacy Gemini operations to models.generate', () => {
		assert.equal(
			canonicalizeRequestOperation('gemini', 'generateContent'),
			GEMINI_GENERATE_OPERATION
		);
		assert.equal(
			canonicalizeRequestOperation('gemini', 'streamGenerateContent'),
			GEMINI_GENERATE_OPERATION
		);
		assert.equal(
			canonicalizeRequestOperation('gemini', GEMINI_GENERATE_OPERATION),
			GEMINI_GENERATE_OPERATION
		);
		assert.equal(canonicalizeRequestOperation('gemini', '*'), '*');
		assert.equal(canonicalizeRequestOperation('openai', 'generateContent'), 'generateContent');
	});

	it('ranks Gemini operation aliases with family highest', () => {
		assert.equal(requestOperationAliasRank(GEMINI_GENERATE_OPERATION), 2);
		assert.equal(requestOperationAliasRank('generateContent'), 1);
		assert.equal(requestOperationAliasRank('streamGenerateContent'), 0);
		assert.equal(requestOperationAliasRank('GENERATECONTENT'), 1);
		assert.equal(requestOperationAliasRank('chat'), -1);
	});

	it('keeps wildcard compatibility for migrated routes', () => {
		assert.equal(normalizeRouteOperation(undefined), '*');
		assert.equal(isRequestOperationForProtocol('openai', '*'), true);
		assert.equal(effectiveUpstreamOperation('*', 'images.generations'), 'images.generations');
		assert.equal(
			effectiveUpstreamOperation('*', 'images.generations', 'dashscope-image-wan'),
			'images.generations.multimodal',
		);
		assert.equal(
			effectiveUpstreamOperation('*', 'chat', 'passthrough'),
			'chat',
		);
		assert.equal(effectiveUpstreamOperation('chat', 'responses'), 'chat');
	});

	it('keeps DashScope realtime ASR model families on their native lifecycle', () => {
		for (const model of ['fun-asr-realtime', 'qwen-audio-3.0-asr-flash-streaming']) {
			assert.equal(
				isDashScopeRealtimeAsrModelOperationCompatible(
					model,
					'audio.transcriptions.realtime.inference',
				),
				true,
			);
			assert.equal(
				isDashScopeRealtimeAsrModelOperationCompatible(
					model,
					'audio.transcriptions.realtime.session',
				),
				false,
			);
		}
		assert.equal(
			isDashScopeRealtimeAsrModelOperationCompatible(
				'qwen3-asr-flash-realtime-2026-02-10',
				'audio.transcriptions.realtime.session',
			),
			true,
		);
		assert.equal(
			isDashScopeRealtimeAsrModelOperationCompatible(
				'qwen3-asr-flash-realtime',
				'audio.transcriptions.realtime.inference',
			),
			false,
		);
	});
});

describe('route adapters', () => {
	it('maps both explicit synchronous DashScope ASR families to the multimodal endpoint', () => {
		for (const adapter of [
			'dashscope-asr-qwen-file',
			'dashscope-asr-qwen-audio-file',
			'dashscope-asr-fun-file',
		]) {
			assert.equal(
				isRouteAdapterCompatible({
					adapter,
					requestProtocol: 'openai',
					requestOperation: 'audio.transcriptions',
					upstreamProtocol: 'dashscope',
					upstreamOperation: 'audio.transcriptions.multimodal',
				}),
				true
			);
		}
	});

	it('keeps passthrough strict about protocol and operation', () => {
		assert.equal(
			isRouteAdapterCompatible({
				adapter: 'passthrough',
				requestProtocol: 'openai',
				requestOperation: 'audio.speech',
				upstreamProtocol: 'openai',
				upstreamOperation: 'audio.speech',
			}),
			true
		);
		assert.equal(
			isRouteAdapterCompatible({
				adapter: 'passthrough',
				requestProtocol: 'openai',
				requestOperation: 'audio.speech',
				upstreamProtocol: 'dashscope',
				upstreamOperation: 'audio.speech',
			}),
			false
		);
	});

	it('allows only the exact cross-protocol mapping declared by an adapter', () => {
		const base = {
			adapter: 'dashscope-tts-speech',
			requestProtocol: 'openai',
			requestOperation: 'audio.speech',
			upstreamProtocol: 'dashscope',
			upstreamOperation: 'audio.speech',
		} as const;
		assert.equal(isRouteAdapterCompatible(base), true);
		assert.equal(
			isRouteAdapterCompatible({
				...base,
				upstreamOperation: 'audio.speech.multimodal',
			}),
			false
		);
		for (const adapter of ['dashscope-tts-qwen', 'dashscope-tts-minimax']) {
			assert.equal(
				isRouteAdapterCompatible({
					adapter,
					requestProtocol: 'openai',
					requestOperation: 'audio.speech',
					upstreamProtocol: 'dashscope',
					upstreamOperation: 'audio.speech.multimodal',
				}),
				true
			);
		}
		for (const adapter of ['dashscope-image-qwen', 'dashscope-image-wan']) {
			assert.equal(
				isRouteAdapterCompatible({
					adapter,
					requestProtocol: 'openai',
					requestOperation: 'images.generations',
					upstreamProtocol: 'dashscope',
					upstreamOperation: 'images.generations.multimodal',
				}),
				true
			);
			assert.equal(
				isRouteAdapterCompatible({
					adapter,
					requestProtocol: 'openai',
					requestOperation: 'images.generations',
					upstreamProtocol: 'dashscope',
					upstreamOperation: '*',
				}),
				true
			);
		}
	});
});
