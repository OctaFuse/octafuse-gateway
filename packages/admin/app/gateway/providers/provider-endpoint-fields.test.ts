import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	listConfiguredCapabilities,
	resolveUpstreamEndpoint,
} from '@octafuse/core/provider-endpoints';
import { UPSTREAM_PROTOCOLS } from '@octafuse/core/upstream-protocol';
import { PROVIDER_ENDPOINT_FIELDS } from './provider-endpoint-fields';
import {
	formDataToEndpointsMap,
	getProtocolEndpointMode,
	partialProtocolForm,
	protocolFormIsConfigured,
	providerToFormData,
	switchProtocolEndpointMode,
} from './provider-utils';
import type { GatewayProvider } from '@/lib/types';
import { EMPTY_PROTOCOL_FORM, EMPTY_PROVIDER_FORM } from './types';

const bases = {
	openai: 'https://api.example.com/v1',
	anthropic: 'https://api.example.com',
	gemini: 'https://api.example.com/v1beta/models',
	dashscope: 'https://api.example.com/api/v1',
	minimax: 'https://api.example.com/v1',
	volcengine: 'https://api.example.com/api/v3',
	elevenlabs: 'https://api.example.com/v1',
};

describe('provider endpoint field descriptions', () => {
	for (const protocol of UPSTREAM_PROTOCOLS) {
		it(`${protocol} lists exactly the capabilities enabled by Base URL`, () => {
			const fields = PROVIDER_ENDPOINT_FIELDS[protocol];
			const capabilities = listConfiguredCapabilities(
				{ [protocol]: { base: bases[protocol] } },
				protocol
			);
			assert.deepEqual(
				fields.map((item) => item.capability).sort(),
				[...capabilities].sort()
			);
			assert.equal(
				new Set(fields.map((item) => item.field)).size,
				fields.length
			);
		});

		for (const item of PROVIDER_ENDPOINT_FIELDS[protocol]) {
			it(`${protocol} ${item.capability} displays the path actually used by the gateway`, () => {
				const action =
					item.capability === 'models.embed'
						? 'embedContent'
						: 'generateContent';
				const path = item.path
					.replace('{model}', 'demo-model')
					.replace('{action}', action)
					.replace('{task_id}', 'demo-task')
					.replace('{voice_id}', 'demo-voice');
				for (const suffix of ['', '/']) {
					const actual = resolveUpstreamEndpoint(
						protocol,
						item.capability,
						{ [protocol]: { base: bases[protocol] + suffix } },
						{
							model: 'demo-model',
							action,
							taskId: 'demo-task',
							voiceId: 'demo-voice',
						}
					);
					const expected = new URL(bases[protocol]);
					expected.pathname = item.originRelative
						? path
						: expected.pathname.replace(/\/$/, '') + path;
					if (item.websocket) expected.protocol = 'wss:';
					assert.equal(actual, expected.toString());
				}
			});
		}

		it(`${protocol} fields still save to their original capability keys`, () => {
			for (const item of PROVIDER_ENDPOINT_FIELDS[protocol]) {
				const url =
					(item.originRelative
						? 'https://api.example.com'
						: bases[protocol]
					).replace('https:', item.websocket ? 'wss:' : 'https:') + item.path;
				const form = {
					...EMPTY_PROVIDER_FORM,
					[protocol]: { ...EMPTY_PROTOCOL_FORM, [item.field]: url },
				};
				const saved = formDataToEndpointsMap(form);
				assert.equal(saved[protocol]?.endpoints?.[item.capability], url);
			}
		});
	}
});

describe('provider capability modes', () => {
	for (const protocol of UPSTREAM_PROTOCOLS) {
		it(`${protocol} switches to explicit endpoints without changing effective URLs`, () => {
			const initial = { ...EMPTY_PROTOCOL_FORM, base: bases[protocol] };
			const partial = switchProtocolEndpointMode(protocol, initial, 'partial');
			const saved = formDataToEndpointsMap({
				...EMPTY_PROVIDER_FORM,
				[protocol]: partial,
			});
			assert.equal(saved[protocol]?.base, undefined);
			assert.equal(
				saved[protocol]?.endpoints &&
					Object.keys(saved[protocol]!.endpoints!).length,
				PROVIDER_ENDPOINT_FIELDS[protocol].length
			);
			for (const { capability } of PROVIDER_ENDPOINT_FIELDS[protocol]) {
				const actions =
					capability === 'models.embed'
						? ['embedContent', 'batchEmbedContents']
						: capability === 'models.generate'
						? ['generateContent', 'streamGenerateContent']
						: [undefined];
				for (const action of actions) {
					const options = {
						model: 'a-model',
						action,
						taskId: 'task/id',
						voiceId: 'voice/id',
					};
					assert.equal(
						resolveUpstreamEndpoint(protocol, capability, saved, options),
						resolveUpstreamEndpoint(
							protocol,
							capability,
							{ [protocol]: { base: bases[protocol] } },
							options
						)
					);
				}
			}
			const all = switchProtocolEndpointMode(protocol, partial, 'all');
			assert.deepEqual(
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: all }),
				{ [protocol]: { base: bases[protocol] } }
			);
			assert.deepEqual(
				switchProtocolEndpointMode(protocol, all, 'partial'),
				partial
			);
		});

		it(`${protocol} empty partial endpoints stay disabled across mode switches`, () => {
			const partial = {
				...EMPTY_PROTOCOL_FORM,
				base: bases[protocol],
				mode: 'partial' as const,
				partialDraftReady: true,
			};
			assert.equal(protocolFormIsConfigured(protocol, partial), false);
			assert.deepEqual(
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: partial }),
				{}
			);
			const restored = switchProtocolEndpointMode(
				protocol,
				switchProtocolEndpointMode(protocol, partial, 'all'),
				'partial'
			);
			assert.deepEqual(restored, partial);
			const { field, capability } = PROVIDER_ENDPOINT_FIELDS[protocol][0];
			const url = `https://custom.example.com${PROVIDER_ENDPOINT_FIELDS[protocol][0].path}`;
			const one = { ...partial, [field]: url };
			assert.deepEqual(
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: one }),
				{ [protocol]: { endpoints: { [capability]: url } } }
			);
		});
	}

	it('infers mode for new, base-only, embedding-only, and mixed configurations', () => {
		assert.equal(getProtocolEndpointMode('openai', EMPTY_PROTOCOL_FORM), 'all');
		assert.equal(
			getProtocolEndpointMode('openai', {
				...EMPTY_PROTOCOL_FORM,
				base: bases.openai,
			}),
			'all'
		);
		assert.equal(
			getProtocolEndpointMode('openai', {
				...EMPTY_PROTOCOL_FORM,
				embeddings: 'https://x.test/embed',
			}),
			'partial'
		);
		assert.equal(
			getProtocolEndpointMode('gemini', {
				...EMPTY_PROTOCOL_FORM,
				modelsEmbed: 'https://x.test/{model}:{action}',
			}),
			'partial'
		);
		const mixed = {
			...EMPTY_PROTOCOL_FORM,
			base: bases.openai,
			chat: 'https://custom.example.com/chat',
		};
		assert.equal(getProtocolEndpointMode('openai', mixed), 'partial');
		const display = partialProtocolForm('openai', mixed);
		assert.equal(display.chat, mixed.chat);
		assert.equal(display.responses, `${bases.openai}/responses`);
		// Opening a mixed config does not rewrite it; editing/switching materializes its fallbacks.
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, openai: mixed }),
			{ openai: { base: bases.openai, endpoints: { chat: mixed.chat } } }
		);
		const partial = switchProtocolEndpointMode('openai', mixed, 'partial');
		assert.equal(partial.chat, mixed.chat);
		assert.equal(partial.responses, display.responses);
		assert.equal(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, openai: partial }).openai
				?.base,
			undefined
		);
	});

	it('preserves legacy Gemini overrides and the missing action inherited from Base URL', () => {
		const config = {
			gemini: {
				base: bases.gemini,
				auth: 'bearer' as const,
				endpoints: {
					generateContent: 'https://custom.example.com/{model}:generateContent',
				},
			},
		};
		const initial = providerToFormData({
			endpoints: JSON.stringify(config),
		} as GatewayProvider).gemini;
		const partial = switchProtocolEndpointMode('gemini', initial, 'partial');
		assert.equal(
			partial.legacyPerAction?.generateContent,
			config.gemini.endpoints.generateContent
		);
		assert.equal(
			partial.legacyPerAction?.streamGenerateContent,
			`${bases.gemini}/{model}:streamGenerateContent`
		);
		const saved = formDataToEndpointsMap({
			...EMPTY_PROVIDER_FORM,
			gemini: partial,
		});
		assert.equal(saved.gemini?.auth, 'bearer');
		for (const action of [
			'generateContent',
			'streamGenerateContent',
			'embedContent',
			'batchEmbedContents',
		]) {
			const capability = action.includes('mbed')
				? 'models.embed'
				: 'models.generate';
			assert.equal(
				resolveUpstreamEndpoint('gemini', capability, saved, {
					model: 'a-model',
					action,
				}),
				resolveUpstreamEndpoint('gemini', capability, config, {
					model: 'a-model',
					action,
				})
			);
		}
		const all = switchProtocolEndpointMode('gemini', partial, 'all');
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, gemini: all }),
			{ gemini: { base: bases.gemini, auth: 'bearer' } }
		);
	});

	it('uses the runtime image endpoint normalization when expanding Base URL', () => {
		const partial = switchProtocolEndpointMode(
			'openai',
			{ ...EMPTY_PROTOCOL_FORM, base: 'https://x.test/v1/images/generations' },
			'partial'
		);
		assert.equal(
			partial.images_generations,
			'https://x.test/v1/images/generations'
		);
		assert.equal(partial.images_edits, 'https://x.test/v1/images/edits');
	});
});
