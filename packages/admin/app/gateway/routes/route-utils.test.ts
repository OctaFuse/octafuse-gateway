import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayModel, GatewayModelRoute, GatewayProvider } from '@/lib/types';
import {
	applyDashScopeTtsRoutePreset,
	buildFormDataFromRoute,
	buildRouteSavePayload,
	formatRoutePriceOverridePreview,
	buildRouteSurfaceCatalog,
	compatibleAdaptersForRoute,
	factorChipClassForValue,
	factorLevelForValue,
	formatFactorMultiplierForChip,
	formatScheduleWindowsHint,
	formatSharedScheduleWindowsHint,
	groupScheduleWindows,
	resolveRouteScheduleDisplay,
	scheduleWindowShapeKey,
	hasBasePricingInversion,
	requestOperationsForModel,
	requestLogProtocolPath,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	splitRoutesByProtocolAndRouteGroup,
	SURFACE_PATH_MODEL_PLACEHOLDER,
	upstreamOperationsForProviderModel,
	type RouteModelGroup,
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

	it('uses a model placeholder when the catalog path is not bound to one model', () => {
		assert.equal(
			requestSurfacePath('gemini', 'models.generate'),
			`/v1beta/models/${SURFACE_PATH_MODEL_PLACEHOLDER}:{generateContent|streamGenerateContent}`,
		);
		assert.equal(
			requestSurfacePath('dashscope', 'audio.transcriptions.realtime.inference'),
			`/v1/dashscope/realtime?model=${SURFACE_PATH_MODEL_PLACEHOLDER}&operation=audio.transcriptions.realtime.inference`,
		);
	});

	it('compacts Gemini endpoints for request-log rows', () => {
		assert.equal(requestLogProtocolPath('gemini', 'models.generate'), '/v1beta/models/{model}');
		assert.equal(requestLogProtocolPath('gemini', 'streamGenerateContent'), '/v1beta/models/{model}');
		assert.equal(requestLogProtocolPath('openai', 'chat'), '/v1/chat/completions');
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
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_second',
						audio: { price_per_second: 0.0001 },
					}),
				}),
				'dashscope',
				'fun-asr-realtime',
			),
			['audio.transcriptions.realtime.inference'],
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
				'qwen3-asr-flash-realtime',
			),
			['audio.transcriptions.realtime.session'],
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
		assert.deepEqual(upstreamOperationsForProviderModel(baseProvider, model(), 'openai'), [
			'chat',
			'responses',
		]);
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
		assert.deepEqual(
			upstreamOperationsForProviderModel(dashScope, asr, 'dashscope', 'fun-asr-realtime'),
			['audio.transcriptions.async', 'audio.transcriptions.realtime.inference'],
		);

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

	it('drops trailing zeros on chip multipliers', () => {
		assert.equal(formatFactorMultiplierForChip(1), '×1');
		assert.equal(formatFactorMultiplierForChip(0), '×0');
		assert.equal(formatFactorMultiplierForChip(1.9), '×1.9');
		assert.equal(formatFactorMultiplierForChip(0.75), '×0.75');
	});
});

describe('resolveEffectiveRouteStrategy', () => {
	it('prefers tier override over pool strategy', () => {
		const effective = resolveEffectiveRouteStrategy({
			poolStrategy: 'weighted_random',
			poolTierStrategies: JSON.stringify({ '10': 'weight_priority' }),
			priority: 10,
			protocol: 'openai',
			requestOperation: 'chat',
			routeGroup: 'default',
			globalStrategy: 'hash_affinity',
		});
		assert.deepEqual(effective, {
			strategy: 'weight_priority',
			source: 'tier',
			inherited: false,
		});
	});

	it('inherits pool strategy when the tier has no override', () => {
		const effective = resolveEffectiveRouteStrategy({
			poolStrategy: 'weighted_random',
			poolTierStrategies: JSON.stringify({ '0': 'weight_priority' }),
			priority: 10,
			protocol: 'openai',
			requestOperation: 'chat',
			routeGroup: 'default',
			globalStrategy: 'hash_affinity',
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
			globalStrategy: 'hash_affinity',
		});
		assert.deepEqual(effective, {
			strategy: 'weighted_round_robin',
			source: 'model',
			inherited: true,
		});
	});
});

describe('provider sticky pool mapping', () => {
	it('maps pool sticky columns onto protocol sections with defaults', () => {
		const sections = splitRoutesByProtocolAndRouteGroup([
			{
				id: 'r1',
				route_pool_id: 'pool-1',
				pool_name: 'Pool',
				route_group: 'default',
				upstream_protocol: 'openai',
				pool_sticky_enabled: 1,
				pool_sticky_idle_ttl_seconds: 1800,
				surfaces: JSON.stringify([
					{
						id: 'surf-1',
						request_protocol: 'openai',
						request_operation: 'chat',
						status: 'active',
					},
				]),
			},
			{
				id: 'r2',
				route_pool_id: 'pool-2',
				pool_name: 'Pool 2',
				route_group: 'default',
				upstream_protocol: 'openai',
				pool_sticky_enabled: 0,
				pool_sticky_idle_ttl_seconds: null,
				surfaces: JSON.stringify([
					{
						id: 'surf-2',
						request_protocol: 'openai',
						request_operation: 'chat',
						status: 'active',
					},
				]),
			},
		]);
		const stickyOn = sections.find((s) => s.poolId === 'pool-1');
		const stickyOff = sections.find((s) => s.poolId === 'pool-2');
		assert.equal(stickyOn?.poolStickyEnabled, true);
		assert.equal(stickyOn?.poolStickyIdleTtlSeconds, 1800);
		assert.equal(stickyOff?.poolStickyEnabled, false);
		assert.equal(stickyOff?.poolStickyIdleTtlSeconds, 3600);
	});
});

function catalogCard(
	overrides: Partial<RouteModelGroup> & Pick<RouteModelGroup, 'model_id' | 'groupRoutes'>,
): RouteModelGroup {
	return {
		title: overrides.title ?? overrides.model_id,
		activeCount: overrides.activeCount ?? overrides.groupRoutes.length,
		vendor: overrides.vendor ?? 'other',
		...overrides,
	};
}

describe('surface catalog grouping', () => {
	it('inverts model cards into request-surface → model → route-group rows', () => {
		const openaiSurface = JSON.stringify([
			{
				id: 'surf-chat',
				request_protocol: 'openai',
				request_operation: 'chat',
				status: 'active',
			},
		]);
		const catalog = buildRouteSurfaceCatalog([
			catalogCard({
				model_id: 'gpt-4o',
				groupRoutes: [
					{
						id: 'r-default',
						model_id: 'gpt-4o',
						upstream_protocol: 'openai',
						route_group: 'default',
						route_pool_id: 'pool-default',
						surfaces: openaiSurface,
					} as RouteModelGroup['groupRoutes'][number],
					{
						id: 'r-vip',
						model_id: 'gpt-4o',
						upstream_protocol: 'openai',
						route_group: 'vip',
						route_pool_id: 'pool-vip',
						surfaces: openaiSurface,
					} as RouteModelGroup['groupRoutes'][number],
				],
			}),
			catalogCard({
				model_id: 'gpt-4.1',
				groupRoutes: [
					{
						id: 'r-41',
						model_id: 'gpt-4.1',
						upstream_protocol: 'openai',
						route_group: 'default',
						route_pool_id: 'pool-41',
						surfaces: openaiSurface,
					} as RouteModelGroup['groupRoutes'][number],
				],
			}),
			catalogCard({
				model_id: 'orphan',
				groupRoutes: [],
			}),
		]);

		assert.equal(catalog.surfaces.length, 1);
		assert.equal(catalog.surfaces[0]?.protocol, 'openai');
		assert.equal(catalog.surfaces[0]?.requestOperation, 'chat');
		assert.deepEqual(
			catalog.surfaces[0]?.models.map((row) => row.card.model_id),
			['gpt-4o', 'gpt-4.1'],
		);
		assert.deepEqual(
			catalog.surfaces[0]?.models[0]?.sections.map((section) => section.group),
			['default', 'vip'],
		);
		assert.deepEqual(
			catalog.unrouted.map((card) => card.model_id),
			['orphan'],
		);
	});
});

describe('formatScheduleWindowsHint', () => {
	it('returns null for an empty schedule', () => {
		assert.equal(formatScheduleWindowsHint([]), null);
	});

	it('groups consecutive windows that share a factor', () => {
		assert.equal(
			formatScheduleWindowsHint([
				{ start: '09:00', end: '12:00', factor: 2 },
				{ start: '14:00', end: '18:00', factor: 2 },
			]),
			'9:00-12:00, 14:00-18:00 ×2',
		);
	});

	it('keeps different factors as separate groups', () => {
		assert.equal(
			formatScheduleWindowsHint([
				{ start: '00:00', end: '08:00', factor: 0.5 },
				{ start: '09:00', end: '18:00', factor: 2 },
			]),
			'0:00-8:00 ×0.5 · 9:00-18:00 ×2',
		);
	});

	it('keeps minutes when a window is not on the hour', () => {
		assert.equal(
			formatScheduleWindowsHint([{ start: '09:30', end: '12:15', factor: 2 }]),
			'9:30-12:15 ×2',
		);
	});

	it('strips leading zeros from hours', () => {
		assert.equal(
			formatScheduleWindowsHint([{ start: '09:00', end: '12:00', factor: 1.9 }]),
			'9:00-12:00 ×1.9',
		);
	});
});

describe('schedule window helpers', () => {
	it('treats matching start/end sequences as the same shape', () => {
		assert.equal(
			scheduleWindowShapeKey([
				{ start: '09:00', end: '12:00', factor: 1.9 },
				{ start: '14:00', end: '18:00', factor: 1.9 },
			]),
			scheduleWindowShapeKey([
				{ start: '09:00', end: '12:00', factor: 2 },
				{ start: '14:00', end: '18:00', factor: 2 },
			]),
		);
	});

	it('groups readable ranges for tooltip hints', () => {
		assert.deepEqual(
			groupScheduleWindows([
				{ start: '09:00', end: '12:00', factor: 1.9 },
				{ start: '14:00', end: '18:00', factor: 1.9 },
			]),
			[{ ranges: ['9:00-12:00', '14:00-18:00'], factor: 1.9 }],
		);
	});
});

function route(overrides: Partial<GatewayModelRoute> = {}): GatewayModelRoute {
	return {
		id: 'r1',
		model_id: 'm1',
		provider_id: 'p1',
		provider_model_name: 'gpt',
		priority: 0,
		status: 'active',
		route_group: 'default',
		price_override: null,
		custom_params: null,
		upstream_protocol: 'openai',
		...overrides,
	};
}

describe('buildFormDataFromRoute / buildRouteSavePayload schedule', () => {
	it('bakes legacy multiply windows into shared override rows', () => {
		const form = buildFormDataFromRoute(
			route({
				price_override: JSON.stringify({
					charged_factor: 1.2,
					metered_factor: 1,
					schedule: {
						charged: [{ start: '09:00', end: '12:00', factor: 0.5 }],
						metered: [{ start: '09:00', end: '18:00', factor: 2 }],
					},
				}),
			}),
			[],
		);
		assert.deepEqual(form.schedule_windows, [
			{ start: '09:00', end: '12:00', charged_factor: '0.6', metered_factor: '2' },
			{ start: '12:00', end: '18:00', charged_factor: '1.2', metered_factor: '2' },
		]);
	});

	it('list display bakes multiply metered 0.5 × window 2 to effective 1', () => {
		const windows = resolveRouteScheduleDisplay(
			JSON.stringify({
				charged_factor: 1,
				metered_factor: 0.5,
				schedule: {
					charged: [
						{ start: '09:00', end: '12:00', factor: 2 },
						{ start: '14:00', end: '18:00', factor: 2 },
					],
					metered: [
						{ start: '09:00', end: '12:00', factor: 2 },
						{ start: '14:00', end: '18:00', factor: 2 },
					],
				},
			}),
		);
		assert.deepEqual(windows, [
			{ start: '09:00', end: '12:00', charged_factor: 2, metered_factor: 1 },
			{ start: '14:00', end: '18:00', charged_factor: 2, metered_factor: 1 },
		]);
		assert.equal(
			formatSharedScheduleWindowsHint(windows),
			'9:00-12:00 C ×2 · M ×1 · 14:00-18:00 C ×2 · M ×1',
		);
	});

	it('writes schedule.mode override with shared windows', () => {
		const payload = buildRouteSavePayload(
			{
				...EMPTY_ROUTE_FORM,
				model_id: 'm1',
				provider_id: 'p1',
				provider_model_name: 'gpt',
				charged_factor: '1',
				metered_factor: '1',
				schedule_windows: [
					{ start: '09:00', end: '12:00', charged_factor: '2', metered_factor: '2' },
				],
			},
			null,
		);
		assert.equal(
			payload.price_override,
			JSON.stringify({
				charged_factor: 1,
				metered_factor: 1,
				schedule: {
					mode: 'override',
					charged: [{ start: '09:00', end: '12:00', factor: 2 }],
					metered: [{ start: '09:00', end: '12:00', factor: 2 }],
				},
			}),
		);
	});

	it('previews the same price_override JSON that save writes', () => {
		const form = {
			...EMPTY_ROUTE_FORM,
			model_id: 'm1',
			provider_id: 'p1',
			provider_model_name: 'gpt',
			charged_factor: '1',
			metered_factor: '1',
			schedule_windows: [
				{ start: '09:00', end: '12:00', charged_factor: '2', metered_factor: '2' },
				{ start: '14:00', end: '18:00', charged_factor: '2', metered_factor: '2' },
			],
		};
		const preview = formatRoutePriceOverridePreview(form);
		assert.equal(preview.ok, true);
		const payload = buildRouteSavePayload(form, null);
		assert.equal(preview.text, JSON.stringify(JSON.parse(String(payload.price_override)), null, 2));
	});

	it('previews an error when a schedule window is invalid', () => {
		const preview = formatRoutePriceOverridePreview({
			...EMPTY_ROUTE_FORM,
			schedule_windows: [{ start: '09:00', end: '09:00', charged_factor: '2', metered_factor: '2' }],
		});
		assert.equal(preview.ok, false);
		assert.match(preview.text, /duration must be non-zero/);
	});
});
