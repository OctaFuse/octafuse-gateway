import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	listConfiguredCapabilities,
	resolveUpstreamEndpoint,
} from '@octafuse/core/provider-endpoints';
import { UPSTREAM_PROTOCOLS } from '@octafuse/core/upstream-protocol';
import {
	PROVIDER_ENDPOINT_FIELDS,
	endpointFieldsForUpstreamOperation,
} from './provider-endpoint-fields';
import {
	formDataToEndpointsMap,
	getProtocolEndpointMode,
	getSelectedProtocolCapabilities,
	toggleProtocolCapability,
	suggestProtocolEndpointUrl,
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

describe('independent provider capability modes', () => {
	for (const protocol of UPSTREAM_PROTOCOLS) {
		it(`${protocol} switching from Base URL neither fills nor selects endpoints`, () => {
			const initial = { ...EMPTY_PROTOCOL_FORM, base: bases[protocol] };
			const partial = switchProtocolEndpointMode(protocol, initial, 'partial');
			assert.deepEqual(getSelectedProtocolCapabilities(protocol, partial), []);
			for (const { field } of PROVIDER_ENDPOINT_FIELDS[protocol])
				assert.equal(partial[field], '');
			assert.deepEqual(
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: partial }),
				{}
			);
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

		it(`${protocol} selecting a capability does not silently adopt the Base URL suggestion`, () => {
			const { field, capability } = PROVIDER_ENDPOINT_FIELDS[protocol][0];
			const selected = toggleProtocolCapability(
				protocol,
				{ ...EMPTY_PROTOCOL_FORM, base: bases[protocol] },
				capability,
				true
			);
			assert.deepEqual(getSelectedProtocolCapabilities(protocol, selected), [
				capability,
			]);
			assert.equal(selected[field], '');
			const suggestion = suggestProtocolEndpointUrl(
				protocol,
				selected.base,
				capability
			);
			assert.ok(suggestion);
			assert.equal(selected[field], '');
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: selected,
				}),
				{}
			);
			const accepted = { ...selected, [field]: suggestion };
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: accepted,
				}),
				{ [protocol]: { endpoints: { [capability]: suggestion } } }
			);
			const all = switchProtocolEndpointMode(protocol, accepted, 'all');
			assert.equal(all[field], suggestion);
			assert.deepEqual(
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: all }),
				{ [protocol]: { base: bases[protocol] } }
			);
			assert.deepEqual(
				switchProtocolEndpointMode(protocol, all, 'partial'),
				accepted
			);
		});

		it(`${protocol} Base URL changes do not overwrite explicit endpoint drafts`, () => {
			const { field, capability } = PROVIDER_ENDPOINT_FIELDS[protocol][0];
			const partial = toggleProtocolCapability(
				protocol,
				{
					...EMPTY_PROTOCOL_FORM,
					base: bases[protocol],
					[field]: 'https://custom.test/endpoint',
				},
				capability,
				true
			);
			const all = {
				...switchProtocolEndpointMode(protocol, partial, 'all'),
				base: 'https://different.test/v2',
			};
			const restored = switchProtocolEndpointMode(protocol, all, 'partial');
			assert.equal(restored[field], partial[field]);
			assert.deepEqual(getSelectedProtocolCapabilities(protocol, restored), [
				capability,
			]);
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: restored,
				}),
				{ [protocol]: { endpoints: { [capability]: partial[field] } } }
			);
		});
	}

	it('infers mode and selection from real overrides only, including mixed configurations', () => {
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
			chat: 'https://custom.test/chat',
		};
		assert.equal(getProtocolEndpointMode('openai', mixed), 'partial');
		assert.deepEqual(getSelectedProtocolCapabilities('openai', mixed), [
			'chat',
		]);
		// Saving unrelated fields must retain the original legacy configuration.
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, openai: mixed }),
			{ openai: { base: bases.openai, endpoints: { chat: mixed.chat } } }
		);
		const partial = switchProtocolEndpointMode('openai', mixed, 'partial');
		assert.equal(partial.responses, '');
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, openai: partial }),
			{ openai: { endpoints: { chat: mixed.chat } } }
		);
	});

	it('legacy Gemini URLs remain explicit; missing actions are only available as suggestions', () => {
		const config = {
			gemini: {
				base: bases.gemini,
				auth: 'bearer' as const,
				endpoints: {
					generateContent: 'https://custom.test/{model}:generateContent',
				},
			},
		};
		const initial = providerToFormData({
			endpoints: JSON.stringify(config),
		} as GatewayProvider).gemini;
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, gemini: initial }),
			config
		);
		const partial = switchProtocolEndpointMode('gemini', initial, 'partial');
		assert.equal(
			partial.legacyPerAction?.generateContent,
			config.gemini.endpoints.generateContent
		);
		assert.equal(partial.legacyPerAction?.streamGenerateContent, '');
		assert.equal(partial.modelsEmbed, '');
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, gemini: partial }),
			{ gemini: { auth: 'bearer', endpoints: config.gemini.endpoints } }
		);
		assert.equal(
			suggestProtocolEndpointUrl(
				'gemini',
				bases.gemini,
				'models.generate',
				'streamGenerateContent'
			),
			`${bases.gemini}/{model}:streamGenerateContent`
		);
	});
});

describe('explicit Base URL suggestions', () => {
	for (const protocol of UPSTREAM_PROTOCOLS) {
		for (const { capability } of PROVIDER_ENDPOINT_FIELDS[protocol]) {
			it(`${protocol} ${capability} suggestion follows runtime resolution`, () => {
				const suggestion = suggestProtocolEndpointUrl(
					protocol,
					bases[protocol],
					capability
				);
				assert.ok(suggestion);
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
						resolveUpstreamEndpoint(
							protocol,
							capability,
							{ [protocol]: { endpoints: { [capability]: suggestion } } },
							options
						),
						resolveUpstreamEndpoint(
							protocol,
							capability,
							{ [protocol]: { base: bases[protocol] } },
							options
						)
					);
				}
			});
		}
		it(`${protocol} does not suggest endpoints for empty or invalid Base URLs`, () => {
			for (const base of ['', 'invalid', 'ftp://x.test/v1'])
				assert.equal(
					suggestProtocolEndpointUrl(
						protocol,
						base,
						PROVIDER_ENDPOINT_FIELDS[protocol][0].capability
					),
					null
				);
		});
	}
	it('normalizes complete OpenAI image bases without duplicating paths', () => {
		assert.equal(
			suggestProtocolEndpointUrl(
				'openai',
				'https://x.test/v1/images/generations',
				'images.generations'
			),
			'https://x.test/v1/images/generations'
		);
		assert.equal(
			suggestProtocolEndpointUrl(
				'openai',
				'https://x.test/v1/images/generations',
				'images.edits'
			),
			'https://x.test/v1/images/edits'
		);
	});
});

describe('provider partial capability selection', () => {
	for (const protocol of UPSTREAM_PROTOCOLS) {
		it(`${protocol} starts empty and preselects only stored single endpoints`, () => {
			assert.deepEqual(
				getSelectedProtocolCapabilities(protocol, EMPTY_PROTOCOL_FORM),
				[]
			);
			assert.deepEqual(
				getSelectedProtocolCapabilities(protocol, {
					...EMPTY_PROTOCOL_FORM,
					base: bases[protocol],
				}),
				[]
			);
			const { field, capability } = PROVIDER_ENDPOINT_FIELDS[protocol][0];
			assert.deepEqual(
				getSelectedProtocolCapabilities(protocol, {
					...EMPTY_PROTOCOL_FORM,
					[field]: 'https://custom.test/endpoint',
				}),
				[capability]
			);
		});
		it(`${protocol} deselection excludes stored endpoints and restores their drafts when reselected`, () => {
			const fields = PROVIDER_ENDPOINT_FIELDS[protocol];
			const initial = {
				...EMPTY_PROTOCOL_FORM,
				base: bases[protocol],
				mode: 'partial' as const,
			};
			for (const { field } of fields)
				initial[field] = `https://custom.test/${field}`;
			const { field, capability } = fields[0];
			const deselected = toggleProtocolCapability(
				protocol,
				initial,
				capability,
				false
			);
			assert.equal(deselected[field], initial[field]);
			assert.equal(
				getSelectedProtocolCapabilities(protocol, deselected).includes(
					capability
				),
				false
			);
			const saved = formDataToEndpointsMap({
				...EMPTY_PROVIDER_FORM,
				[protocol]: deselected,
			});
			assert.equal(saved[protocol]?.base, undefined);
			assert.deepEqual(
				listConfiguredCapabilities(saved, protocol).sort(),
				fields
					.slice(1)
					.map(({ capability }) => capability)
					.sort()
			);
			const restored = switchProtocolEndpointMode(
				protocol,
				switchProtocolEndpointMode(protocol, deselected, 'all'),
				'partial'
			);
			assert.deepEqual(restored, deselected);
			const reselected = toggleProtocolCapability(
				protocol,
				restored,
				capability,
				true
			);
			assert.equal(reselected[field], initial[field]);
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: reselected,
				}),
				formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, [protocol]: initial })
			);
		});
		it(`${protocol} selected blank URLs and deselected drafts remain disabled`, () => {
			const { field, capability } = PROVIDER_ENDPOINT_FIELDS[protocol][0];
			const selected = toggleProtocolCapability(
				protocol,
				EMPTY_PROTOCOL_FORM,
				capability,
				true
			);
			assert.deepEqual(getSelectedProtocolCapabilities(protocol, selected), [
				capability,
			]);
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: selected,
				}),
				{}
			);
			const deselected = toggleProtocolCapability(
				protocol,
				{ ...selected, [field]: 'https://custom.test/endpoint' },
				capability,
				false
			);
			assert.deepEqual(
				getSelectedProtocolCapabilities(protocol, deselected),
				[]
			);
			assert.equal(protocolFormIsConfigured(protocol, deselected), false);
			assert.deepEqual(
				formDataToEndpointsMap({
					...EMPTY_PROVIDER_FORM,
					[protocol]: deselected,
				}),
				{}
			);
		});
	}
	it('legacy Gemini selection controls and restores both per-action URLs', () => {
		const initial = {
			...EMPTY_PROTOCOL_FORM,
			legacyPerAction: {
				generateContent: 'https://generate.test/{model}:generateContent',
				streamGenerateContent:
					'https://stream.test/{model}:streamGenerateContent',
			},
		};
		assert.deepEqual(getSelectedProtocolCapabilities('gemini', initial), [
			'models.generate',
		]);
		const deselected = toggleProtocolCapability(
			'gemini',
			initial,
			'models.generate',
			false
		);
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, gemini: deselected }),
			{}
		);
		const reselected = toggleProtocolCapability(
			'gemini',
			deselected,
			'models.generate',
			true
		);
		assert.deepEqual(
			formDataToEndpointsMap({ ...EMPTY_PROVIDER_FORM, gemini: reselected })
				.gemini?.endpoints,
			initial.legacyPerAction
		);
	});
});

describe('route capabilities share endpoint configuration labels', () => {
	it('resolves every direct capability to the existing endpoint metadata', () => {
		for (const protocol of UPSTREAM_PROTOCOLS) {
			for (const field of PROVIDER_ENDPOINT_FIELDS[protocol]) {
				assert.deepEqual(
					endpointFieldsForUpstreamOperation(protocol, field.capability),
					[field]
				);
			}
		}
	});

	it('maps DashScope operation variants to the actual endpoint requirements', () => {
		const cases = [
			[
				'audio.transcriptions.async',
				['audio.transcriptions', 'audio.transcriptions.tasks'],
			],
			['audio.transcriptions.realtime.inference', ['audio.realtime.inference']],
			['audio.transcriptions.realtime.session', ['audio.realtime.session']],
			['audio.speech.realtime.inference', ['audio.realtime.inference']],
			['audio.speech.realtime.session', ['audio.realtime.session']],
			['audio.speech.stream', ['audio.speech']],
		] as const;
		for (const [operation, capabilities] of cases) {
			assert.deepEqual(
				endpointFieldsForUpstreamOperation('dashscope', operation).map(
					({ capability }) => capability
				),
				capabilities
			);
		}
		assert.deepEqual(
			endpointFieldsForUpstreamOperation(
				'dashscope',
				'audio.transcriptions.async'
			).map(({ description }) => description),
			['asyncTranscription', 'transcriptionTasks']
		);
	});

	it('uses the canonical Gemini generation label for legacy wire actions', () => {
		for (const operation of [
			'generateContent',
			'streamGenerateContent',
			'models.generate',
		]) {
			assert.deepEqual(
				endpointFieldsForUpstreamOperation('gemini', operation).map(
					({ description }) => description
				),
				['geminiGenerate']
			);
		}
	});

	it('does not label wildcard or unknown operations as all capabilities', () => {
		for (const operation of [
			undefined,
			null,
			'',
			'  ',
			'*',
			'future.capability',
		])
			assert.deepEqual(
				endpointFieldsForUpstreamOperation('openai', operation),
				[]
			);
		assert.deepEqual(endpointFieldsForUpstreamOperation('unknown', 'chat'), []);
	});
});
