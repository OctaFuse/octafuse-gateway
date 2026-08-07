import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	applyDashScopeTtsRoutePreset,
	compatibleAdaptersForRoute,
	factorChipClassForValue,
	factorLevelForValue,
	hasBasePricingInversion,
	requestOperationsForModel,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	upstreamOperationsForProviderModel,
} from './route-utils';
import { EMPTY_ROUTE_FORM } from './types';

function model(overrides: Partial<GatewayModel> = {}): GatewayModel {
	return {
		id: 'model-1',
		display_name: 'Model 1',
		vendor: 'other',
		context_window: 128_000,
		max_tokens: 4096,
		tags: '[]',
		description: null,
		metadata: null,
		created_at: '',
		...overrides,
	};
}

function provider(endpoints: object): GatewayProvider {
	return {
		id: 'provider-1',
		name: 'Provider 1',
		endpoints: JSON.stringify(endpoints),
		description: null,
		created_at: '',
	};
}

describe('request surface path', () => {
	it('maps OpenAI audio operations to their real slash-separated endpoints', () => {
		assert.equal(requestSurfacePath('openai', 'audio.transcriptions', 'audio-model'), '/v1/audio/transcriptions');
		assert.equal(requestSurfacePath('openai', 'audio.speech', 'audio-model'), '/v1/audio/speech');
	});

	it('shows the shared DashScope realtime WebSocket entry with routing parameters', () => {
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.inference', 'my fun/asr'),
			'/v1/dashscope/realtime?model=my%20fun%2Fasr&operation=audio.transcriptions.realtime.inference',
		);
	});
});

describe('route form capability filters', () => {
	it('builds DashScope TTS presets for both public modes', () => {
		const nonRealtime = applyDashScopeTtsRoutePreset(EMPTY_ROUTE_FORM, 'nonrealtime');
		assert.deepEqual(
			{
				requestProtocol: nonRealtime.request_protocol,
				requestOperation: nonRealtime.request_operation,
				upstreamProtocol: nonRealtime.upstream_protocol,
				upstreamOperation: nonRealtime.upstream_operation,
				adapter: nonRealtime.adapter,
			},
			{
				requestProtocol: 'openai',
				requestOperation: 'audio.speech',
				upstreamProtocol: 'dashscope',
				upstreamOperation: 'audio.speech',
				adapter: 'dashscope-tts-speech',
			},
		);

		const realtime = applyDashScopeTtsRoutePreset(EMPTY_ROUTE_FORM, 'realtime');
		assert.deepEqual(
			{
				requestProtocol: realtime.request_protocol,
				requestOperation: realtime.request_operation,
				upstreamProtocol: realtime.upstream_protocol,
				upstreamOperation: realtime.upstream_operation,
				adapter: realtime.adapter,
			},
			{
				requestProtocol: 'dashscope',
				requestOperation: 'audio.speech.realtime.inference',
				upstreamProtocol: 'dashscope',
				upstreamOperation: 'audio.speech.realtime.inference',
				adapter: 'passthrough',
			},
		);
	});

	it('limits public operations by model modality', () => {
		assert.deepEqual(requestOperationsForModel(model(), 'openai'), ['chat', 'responses']);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					input_modalities: '["text","image"]',
					output_modalities: '["image"]',
				}),
				'openai',
			),
			['images.generations', 'images.edits'],
		);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					input_modalities: '["audio"]',
					output_modalities: '["text"]',
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_second',
						audio: { price_per_second: 0.0001, minimum_seconds: 1 },
					}),
				}),
				'openai',
			),
			['audio.transcriptions'],
		);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_second',
						audio: { price_per_second: 0.0001 },
					}),
				}),
				'dashscope',
			),
			['audio.transcriptions.realtime.inference', 'audio.transcriptions.realtime.session'],
		);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					input_modalities: '["text"]',
					output_modalities: '["audio"]',
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_character',
						audio: { price_per_character: 0.0001 },
					}),
				}),
				'openai',
			),
			['audio.speech'],
		);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_character',
						audio: { price_per_character: 0.0001 },
					}),
				}),
				'dashscope',
			),
			['audio.speech.realtime.inference'],
		);
	});

	it('intersects provider endpoint capabilities with the model modality', () => {
		const baseProvider = provider({
			openai: { base: 'https://example.com/v1' },
		});
		assert.deepEqual(upstreamOperationsForProviderModel(baseProvider, model(), 'openai'), ['chat']);
		assert.deepEqual(
			upstreamOperationsForProviderModel(
				baseProvider,
				model({
					input_modalities: '["text","image"]',
					output_modalities: '["image"]',
				}),
				'openai',
			),
			['images.generations', 'images.edits'],
		);

		const endpointOnlyProvider = provider({
			openai: {
				endpoints: {
					'images.edits': 'https://example.com/v1/images/edits',
				},
			},
		});
		assert.deepEqual(
			upstreamOperationsForProviderModel(
				endpointOnlyProvider,
				model({
					input_modalities: '["text","image"]',
					output_modalities: '["image"]',
				}),
				'openai',
			),
			['images.edits'],
		);
	});

	it('maps DashScope endpoint capabilities to explicit audio route operations', () => {
		const dashScope = provider({
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		});
		const asr = model({
			pricing_profile: JSON.stringify({
				audio_billing_mode: 'per_second',
				audio: { price_per_second: 0.0001 },
			}),
		});
		assert.deepEqual(upstreamOperationsForProviderModel(dashScope, asr, 'dashscope'), [
			'audio.transcriptions.async',
			'audio.transcriptions.realtime.inference',
			'audio.transcriptions.realtime.session',
		]);

		const tts = model({
			pricing_profile: JSON.stringify({
				audio_billing_mode: 'per_character',
				audio: { price_per_character: 0.0001 },
			}),
		});
		assert.deepEqual(upstreamOperationsForProviderModel(dashScope, tts, 'dashscope'), [
			'audio.speech',
			'audio.speech.realtime.inference',
		]);
	});

	it('only offers adapters that exactly match the selected topology', () => {
		assert.deepEqual(
			compatibleAdaptersForRoute({
				request_protocol: 'openai',
				request_operation: 'audio.transcriptions',
				upstream_protocol: 'dashscope',
				upstream_operation: 'audio.transcriptions.multimodal',
			}),
			['dashscope-asr-qwen-file', 'dashscope-asr-fun-file'],
		);
		assert.deepEqual(
			compatibleAdaptersForRoute({
				request_protocol: 'openai',
				request_operation: 'audio.speech',
				upstream_protocol: 'dashscope',
				upstream_operation: 'audio.speech.multimodal',
			}),
			['dashscope-tts-qwen', 'dashscope-tts-minimax'],
		);
		assert.deepEqual(
			compatibleAdaptersForRoute({
				request_protocol: 'openai',
				request_operation: 'audio.transcriptions',
				upstream_protocol: 'dashscope',
				upstream_operation: 'audio.transcriptions.async',
			}),
			['dashscope-asr-file-async'],
		);
	});
});

describe('route factor presentation', () => {
	it('classifies distance from the catalog baseline', () => {
		assert.equal(factorLevelForValue(Number.NaN), 'invalid');
		assert.equal(factorLevelForValue(-1), 'invalid');
		assert.equal(factorLevelForValue(0), 'zero');
		assert.equal(factorLevelForValue(0.79), 'veryLow');
		assert.equal(factorLevelForValue(0.8), 'low');
		assert.equal(factorLevelForValue(0.95), 'baseline');
		assert.equal(factorLevelForValue(1.05), 'baseline');
		assert.equal(factorLevelForValue(1.06), 'high');
		assert.equal(factorLevelForValue(1.2), 'high');
		assert.equal(factorLevelForValue(1.21), 'veryHigh');
	});

	it('uses different low-factor semantics for charged price and metered cost', () => {
		assert.match(factorChipClassForValue(0.9, 'charged'), /bg-sky-100/);
		assert.match(factorChipClassForValue(0.9, 'metered'), /bg-emerald-100/);
		assert.match(factorChipClassForValue(0.5, 'charged'), /bg-orange-100/);
		assert.match(factorChipClassForValue(0.5, 'metered'), /bg-emerald-200/);
		assert.match(factorChipClassForValue(1, 'charged'), /bg-zinc-100/);
		assert.match(factorChipClassForValue(1.1, 'metered'), /bg-amber-100/);
		assert.match(factorChipClassForValue(1.5, 'metered'), /bg-rose-100/);
	});

	it('flags a base-price inversion only when charged is below metered', () => {
		assert.equal(hasBasePricingInversion(0.9, 1), true);
		assert.equal(hasBasePricingInversion(1, 1), false);
		assert.equal(hasBasePricingInversion(1.1, 1), false);
		assert.equal(hasBasePricingInversion(Number.NaN, 1), false);
	});
});

describe('resolveEffectiveRouteStrategy', () => {
	it('prefers tier override over pool strategy', () => {
		const effective = resolveEffectiveRouteStrategy({
			poolStrategy: 'weighted_random',
			poolTierStrategies: JSON.stringify({ '10': 'fixed_order' }),
			priority: 10,
			protocol: 'openai',
			requestOperation: 'chat',
			routeGroup: 'default',
			globalStrategy: 'cache_affinity',
		});
		assert.deepEqual(effective, {
			strategy: 'fixed_order',
			source: 'tier',
			inherited: false,
		});
	});

	it('inherits pool strategy when the tier has no override', () => {
		const effective = resolveEffectiveRouteStrategy({
			poolStrategy: 'weighted_random',
			poolTierStrategies: JSON.stringify({ '0': 'fixed_order' }),
			priority: 10,
			protocol: 'openai',
			requestOperation: 'chat',
			routeGroup: 'default',
			globalStrategy: 'cache_affinity',
		});
		assert.deepEqual(effective, {
			strategy: 'weighted_random',
			source: 'pool',
			inherited: true,
		});
	});

	it('falls back through model / global when pool is unset', () => {
		const effective = resolveEffectiveRouteStrategy({
			priority: 1,
			routePolicyRaw: JSON.stringify({ strategy: 'weighted_round_robin' }),
			protocol: 'openai',
			requestOperation: 'chat',
			routeGroup: 'default',
			globalStrategy: 'cache_affinity',
		});
		assert.deepEqual(effective, {
			strategy: 'weighted_round_robin',
			source: 'model',
			inherited: true,
		});
	});
});
