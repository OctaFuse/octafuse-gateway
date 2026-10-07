import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	AUDIO_SPEECH_KNOWN_KEYS,
	IMAGE_GENERATION_KNOWN_KEYS,
	UPSTREAM_EXTRA_FIELDS_MAX_BYTES,
	UpstreamExtraFieldsError,
	applyUpstreamExtraFields,
	pickExtraFields,
	protectedUpstreamPathsForRoute,
} from './upstream-extra-fields';

describe('pickExtraFields', () => {
	it('drops OpenAI image fields the gateway already maps', () => {
		assert.deepEqual(
			pickExtraFields(
				{
					model: 'wan',
					prompt: 'a cat',
					n: 2,
					user: 'sdk',
					parameters: { negative_prompt: 'blurry', seed: 42 },
				},
				IMAGE_GENERATION_KNOWN_KEYS,
			),
			{ parameters: { negative_prompt: 'blurry', seed: 42 } },
		);
	});

	it('rejects payloads over the size cap', () => {
		assert.throws(
			() => pickExtraFields({ blob: 'x'.repeat(UPSTREAM_EXTRA_FIELDS_MAX_BYTES) }, AUDIO_SPEECH_KNOWN_KEYS),
			UpstreamExtraFieldsError,
		);
	});
});

describe('applyUpstreamExtraFields', () => {
	it('merges route defaults, the adapter body, then client extras', () => {
		const applied = applyUpstreamExtraFields({
			built: {
				model: 'wan2.7-image',
				parameters: { n: 1, size: '1024*1024' },
			},
			customParams: { body: { parameters: { seed: 7, prompt_extend: true } } },
			extras: { parameters: { negative_prompt: 'blurry', prompt_extend: false } },
			protectedPaths: ['parameters.n'],
		});
		assert.deepEqual(applied.body, {
			model: 'wan2.7-image',
			parameters: {
				seed: 7,
				prompt_extend: false,
				n: 1,
				size: '1024*1024',
				negative_prompt: 'blurry',
			},
		});
		assert.deepEqual(applied.restoredPaths, []);
	});

	it('lets force_override replace extras, then restores protected paths', () => {
		const applied = applyUpstreamExtraFields({
			built: { model: 'image-01', n: 1, response_format: 'url', prompt: 'lantern' },
			customParams: {
				body: { n: 9, prompt_optimizer: true },
				force_override: { body: true },
			},
			extras: { n: 4, aigc_watermark: false },
			protectedPaths: ['n', 'response_format'],
		});
		assert.equal(applied.body.n, 1);
		assert.equal(applied.body.prompt_optimizer, true);
		assert.equal(applied.body.aigc_watermark, false);
		assert.deepEqual(applied.restoredPaths, ['n']);
	});

	it('removes a protected path the adapter did not set', () => {
		const applied = applyUpstreamExtraFields({
			built: { model: 'speech-2.8-hd', text: 'hi' },
			extras: { stream: true },
			protectedPaths: ['stream'],
		});
		assert.equal('stream' in applied.body, false);
		assert.deepEqual(applied.restoredPaths, ['stream']);
	});
});

describe('protectedUpstreamPathsForRoute', () => {
	it('reads conversion adapters by id and passthrough adapters by protocol', () => {
		assert.deepEqual(protectedUpstreamPathsForRoute({
			adapter: 'minimax-image',
			upstreamProtocol: 'minimax',
			upstreamOperation: 'images.generations',
		}), ['n', 'response_format']);
		assert.deepEqual(protectedUpstreamPathsForRoute({
			adapter: 'passthrough',
			upstreamProtocol: 'openai',
			upstreamOperation: 'images.generations',
		}), ['n', 'stream']);
	});
});
