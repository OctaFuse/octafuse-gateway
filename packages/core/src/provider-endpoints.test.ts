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

	it('derives responses from openai base', () => {
		const url = resolveUpstreamEndpoint('openai', 'responses', {
			openai: { base: 'https://api.x.ai/v1' },
		});
		assert.equal(url, 'https://api.x.ai/v1/responses');
	});

	it('uses responses capability template without appending suffix', () => {
		const url = resolveUpstreamEndpoint('openai', 'responses', {
			openai: {
				endpoints: { responses: 'https://vendor.example/custom/responses' },
			},
		});
		assert.equal(url, 'https://vendor.example/custom/responses');
	});

	it('derives audio.transcriptions from openai base', () => {
		const url = resolveUpstreamEndpoint('openai', 'audio.transcriptions', {
			openai: { base: 'https://api.openai.com/v1' },
		});
		assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
	});

	it('uses capability template without appending suffix', () => {
		const url = resolveUpstreamEndpoint('openai', 'chat', {
			openai: {
				endpoints: { chat: 'https://vendor.example/custom/chat' },
			},
		});
		assert.equal(url, 'https://vendor.example/custom/chat');
	});

	it('fills gemini {model} in legacy per-action template', () => {
		const url = resolveUpstreamEndpoint(
			'gemini',
			'models.generate',
			{
				gemini: {
					endpoints: {
						generateContent: 'https://x.example/models/{model}:generateContent',
					},
				},
			},
			{ model: 'gemini-2.0-flash', action: 'generateContent' }
		);
		assert.equal(url, 'https://x.example/models/gemini-2.0-flash:generateContent');
	});

	it('prefers models.generate family template over legacy per-action', () => {
		const url = resolveUpstreamEndpoint(
			'gemini',
			'models.generate',
			{
				gemini: {
					endpoints: {
						'models.generate': 'https://family.example/models/{model}:{action}',
						generateContent: 'https://legacy.example/models/{model}:generateContent',
					},
				},
			},
			{ model: 'gemini-2.0-flash', action: 'streamGenerateContent' }
		);
		assert.equal(url, 'https://family.example/models/gemini-2.0-flash:streamGenerateContent');
	});

	it('derives gemini URL from base when no templates exist', () => {
		const url = resolveUpstreamEndpoint(
			'gemini',
			'models.generate',
			{ gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' } },
			{ model: 'gemini-2.0-flash', action: 'generateContent' }
		);
		assert.equal(
			url,
			'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
		);
	});

	it('derives DashScope HTTP and WebSocket audio endpoints from one API base', () => {
		const endpoints = {
			dashscope: {
				base: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1',
			},
		};
		assert.equal(
			resolveUpstreamEndpoint('dashscope', 'audio.transcriptions.multimodal', endpoints),
			'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
		);
		assert.equal(
			resolveUpstreamEndpoint('dashscope', 'audio.transcriptions', endpoints),
			'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/transcription'
		);
		assert.equal(
			resolveUpstreamEndpoint('dashscope', 'audio.transcriptions.tasks', endpoints, {
				taskId: 'task/1',
			}),
			'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/tasks/task%2F1'
		);
		assert.equal(
			resolveUpstreamEndpoint('dashscope', 'audio.realtime.inference', endpoints),
			'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference'
		);
		assert.equal(
			resolveUpstreamEndpoint('dashscope', 'audio.realtime.session', endpoints),
			'wss://workspace.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime'
		);
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

	it('accepts legacy gemini per-action keys on write', () => {
		const map = validateAndNormalizeProviderEndpoints({
			gemini: {
				endpoints: {
					generateContent: 'https://x.example/models/{model}:generateContent',
				},
			},
		});
		assert.equal(
			map.gemini?.endpoints?.generateContent,
			'https://x.example/models/{model}:generateContent'
		);
	});

	it('rejects models.generate template without {action}', () => {
		assert.throws(
			() =>
				validateAndNormalizeProviderEndpoints({
					gemini: {
						endpoints: {
							'models.generate': 'https://x.example/models/{model}:generateContent',
						},
					},
				}),
			/must include \{action\}/
		);
	});

	it('accepts wss only for DashScope realtime capabilities', () => {
		const normalized = validateAndNormalizeProviderEndpoints({
			dashscope: {
				endpoints: {
					'audio.realtime.inference': 'wss://workspace.example/api-ws/v1/inference',
				},
			},
		});
		assert.equal(
			normalized.dashscope?.endpoints?.['audio.realtime.inference'],
			'wss://workspace.example/api-ws/v1/inference'
		);
		assert.throws(
			() =>
				validateAndNormalizeProviderEndpoints({
					dashscope: {
						endpoints: { 'audio.speech': 'wss://workspace.example/tts' },
					},
				}),
			/must be http\(s\)/
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
			['chat', 'responses', 'images.generations', 'images.edits', 'audio.transcriptions', 'audio.speech']
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
			['chat', 'responses', 'images.generations', 'images.edits', 'audio.transcriptions', 'audio.speech']
		);
	});

	it('returns empty array when protocol is not configured', () => {
		assert.deepEqual(listConfiguredCapabilities({}, 'anthropic'), []);
	});

	it('maps any gemini override key to models.generate', () => {
		assert.deepEqual(
			listConfiguredCapabilities(
				{
					gemini: {
						endpoints: {
							generateContent: 'https://x.example/models/{model}:generateContent',
						},
					},
				},
				'gemini'
			),
			['models.generate']
		);
	});

	it('lists every DashScope capability when its API base is configured', () => {
		assert.deepEqual(
			listConfiguredCapabilities(
				{ dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' } },
				'dashscope'
			),
			[
				'audio.transcriptions',
				'audio.transcriptions.multimodal',
				'audio.transcriptions.tasks',
				'audio.speech',
				'audio.speech.multimodal',
				'audio.realtime.inference',
				'audio.realtime.session',
				'audio.hotwords',
				'audio.voices',
			]
		);
	});
});
