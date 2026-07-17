import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	providerSupportsUpstreamProtocol,
	resolveUpstreamEndpoint,
	validateAndNormalizeProviderEndpoints,
} from './provider-endpoints';

describe('parseProviderEndpoints', () => {
	it('uses endpoints column when present', () => {
		const map = parseProviderEndpoints({
			endpoints: JSON.stringify({
				openai: { base: 'https://api.openai.com/v1' },
			}),
		});
		assert.equal(map.openai?.base, 'https://api.openai.com/v1');
	});

	it('returns empty map when endpoints is null', () => {
		const map = parseProviderEndpoints({ endpoints: null });
		assert.deepEqual(map, {});
	});

	it('returns empty map when endpoints is empty object', () => {
		const map = parseProviderEndpoints({ endpoints: '{}' });
		assert.deepEqual(map, {});
	});
});

describe('resolveUpstreamEndpoint', () => {
	it('derives chat from openai base', () => {
		const url = resolveUpstreamEndpoint('openai', 'chat', {
			openai: { base: 'https://api.openai.com/v1' },
		});
		assert.equal(url, 'https://api.openai.com/v1/chat/completions');
	});

	it('uses capability template without appending suffix', () => {
		const url = resolveUpstreamEndpoint('openai', 'chat', {
			openai: {
				endpoints: { chat: 'https://vendor.example/custom/chat' },
			},
		});
		assert.equal(url, 'https://vendor.example/custom/chat');
	});

	it('fills gemini {model} in template', () => {
		const url = resolveUpstreamEndpoint(
			'gemini',
			'generateContent',
			{
				gemini: {
					endpoints: {
						generateContent: 'https://x.example/models/{model}:generateContent',
					},
				},
			},
			{ model: 'gemini-2.0-flash' }
		);
		assert.equal(url, 'https://x.example/models/gemini-2.0-flash:generateContent');
	});
});

describe('providerSupportsUpstreamProtocol', () => {
	it('true when only capability endpoints exist', () => {
		assert.equal(
			providerSupportsUpstreamProtocol('openai', {
				endpoints: {
					openai: { endpoints: { chat: 'https://v.example/chat' } },
				},
			}),
			true
		);
	});
});

describe('validateAndNormalizeProviderEndpoints', () => {
	it('rejects gemini template without {model}', () => {
		assert.throws(
			() =>
				validateAndNormalizeProviderEndpoints({
					gemini: {
						endpoints: {
							generateContent: 'https://x.example/generate',
						},
					},
				}),
			/must include \{model\}/
		);
	});
});

describe('listConfiguredCapabilities', () => {
	it('returns all protocol capabilities when base is set', () => {
		assert.deepEqual(
			listConfiguredCapabilities(
				{ openai: { base: 'https://api.openai.com/v1' } },
				'openai'
			),
			['chat', 'images.generations', 'images.edits']
		);
	});

	it('returns only explicit overrides when base is absent', () => {
		assert.deepEqual(
			listConfiguredCapabilities(
				{
					openai: {
						endpoints: { chat: 'https://vendor.example/chat' },
					},
				},
				'openai'
			),
			['chat']
		);
	});

	it('returns all capabilities when base is set even with partial overrides', () => {
		assert.deepEqual(
			listConfiguredCapabilities(
				{
					openai: {
						base: 'https://api.openai.com/v1',
						endpoints: { chat: 'https://vendor.example/chat' },
					},
				},
				'openai'
			),
			['chat', 'images.generations', 'images.edits']
		);
	});

	it('returns empty array when protocol is not configured', () => {
		assert.deepEqual(listConfiguredCapabilities({}, 'anthropic'), []);
	});
});
