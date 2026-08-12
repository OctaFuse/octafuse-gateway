'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
	isAudioModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { isRouteStrategyName } from '@octafuse/core/db/model-route-policy';
import { parseRoutePoolTierStrategies } from '@octafuse/core/db/route-pool-tier-strategies';
import { DEFAULT_STICKY_IDLE_TTL_SECONDS } from '@octafuse/core/db/route-pool-sticky-types';
import { useBusinessTimezone } from '@/components/BusinessTimezoneProvider';
import { getCatalogAudioPricingDisplay, isAudioRouteModel } from '@/lib/audio-transcriptions';
import { isImageRouteModel } from '@/lib/image-generations';
import { getCatalogImagePricingDisplay, getCatalogPricingTierRows } from '@/lib/pricing-ui';
import { normalizeModelVendorInput } from '@/lib/model-vendor';
import { normalizeRouteGroup } from '@/lib/route-group-ui';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import {
	UPSTREAM_PROTOCOLS,
	providerSupportsUpstreamProtocol,
	type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	DEFAULT_ROUTE_KIND_FILTER,
	parseRouteKindFilterParam,
	type RouteKindFilter,
} from './types';
import { useModelEditModal } from '../models/use-model-edit-modal';
import {
	deleteRoute,
	fetchRoutesPageData,
	patchModelRoutePolicy,
	patchRoutePoolPolicy,
	saveRoute,
	toggleRouteStatus,
} from './route-api';
import {
	buildActiveFilterSummary,
	buildFormDataFromRoute,
	buildRouteCardVendorGroups,
	buildRoutePolicyPatch,
	buildRoutesByModel,
	buildVendorFilterOptions,
	compatibleAdaptersForRoute,
	createInitialRouteForm,
	readRoutePolicyFormFromRaw,
	resolveEffectiveRouteStrategy,
	sortRouteCards,
	upstreamOperationsForProviderModel,
} from './route-utils';
import {
	EMPTY_ROUTE_FORM,
	type ProviderStickyDialogState,
	type ProviderStickyFormState,
	type RouteFormData,
	type RouteListRow,
	type RoutePolicyDialogState,
	type RoutePolicyFormState,
} from './types';

export function useRoutesPageState() {
	const searchParams = useSearchParams();
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [models, setModels] = useState<GatewayModel[]>([]);
	const [providers, setProviders] = useState<GatewayProvider[]>([]);
	const [globalRouteStrategy, setGlobalRouteStrategy] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editingRoute, setEditingRoute] = useState<RouteListRow | null>(null);
	const [duplicateSourceRouteId, setDuplicateSourceRouteId] = useState<string | null>(null);
	const [formData, setFormData] = useState<RouteFormData>(EMPTY_ROUTE_FORM);
	const [filterVendor, setFilterVendor] = useState('');
	const [filterProviderId, setFilterProviderId] = useState('');
	const [filterRouteGroup, setFilterRouteGroup] = useState('');
	const [filterStatus, setFilterStatus] = useState('');
	const [filterKind, setFilterKind] = useState<RouteKindFilter>(DEFAULT_ROUTE_KIND_FILTER);
	const [saveError, setSaveError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
	const [strategyDialog, setStrategyDialog] = useState<RoutePolicyDialogState | null>(null);
	const [strategyForm, setStrategyForm] = useState<RoutePolicyFormState>({
		protocolStrategy: '',
		tierStrategy: '',
		capabilityStrategies: {},
	});
	const [strategySaving, setStrategySaving] = useState(false);
	const [strategyError, setStrategyError] = useState('');
	const [stickyDialog, setStickyDialog] = useState<ProviderStickyDialogState | null>(null);
	const [stickyForm, setStickyForm] = useState<ProviderStickyFormState>({
		enabled: false,
		idleTtlSeconds: DEFAULT_STICKY_IDLE_TTL_SECONDS,
	});
	const [stickySaving, setStickySaving] = useState(false);
	const [stickyError, setStickyError] = useState('');
	const { currency: billingCurrency } = useBillingCurrency();
	const businessTimezone = useBusinessTimezone();

	useEffect(() => {
		const vendor = searchParams.get('vendor');
		const providerId = searchParams.get('provider_id');
		const status = searchParams.get('status');
		const routeGroup = searchParams.get('route_group');
		const kind = searchParams.get('kind');
		setFilterVendor(vendor ? normalizeModelVendorInput(vendor) : '');
		setFilterProviderId(providerId ?? '');
		setFilterStatus(status ?? '');
		setFilterRouteGroup(routeGroup ?? '');
		setFilterKind(parseRouteKindFilterParam(kind));
	}, [searchParams]);

	useReplaceListPageQuery(() => {
		const params = new URLSearchParams();
		if (filterVendor) params.set('vendor', filterVendor);
		if (filterProviderId) params.set('provider_id', filterProviderId);
		if (filterRouteGroup) params.set('route_group', filterRouteGroup);
		if (filterStatus) params.set('status', filterStatus);
		params.set('kind', filterKind);
		return params;
	}, [filterVendor, filterProviderId, filterRouteGroup, filterStatus, filterKind]);

	const refreshRoutesPage = useCallback(async () => {
		try {
			const data = await fetchRoutesPageData();
			setRoutes(data.routes);
			setModels(data.models);
			setProviders(data.providers);
			setGlobalRouteStrategy(data.globalRouteStrategy);
		} catch (error) {
			console.error('Fetch data error:', error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const modelEdit = useModelEditModal({ onChanged: refreshRoutesPage });

	useEffect(() => {
		void refreshRoutesPage();
	}, [refreshRoutesPage]);

	const modelMeta = useMemo(() => {
		const map = new Map<string, GatewayModel>();
		for (const m of models) {
			map.set(m.id, m);
		}
		return map;
	}, [models]);

	const providerMeta = useMemo(() => {
		const map = new Map<string, GatewayProvider>();
		for (const provider of providers) map.set(provider.id, provider);
		return map;
	}, [providers]);

	const distinctRouteGroups = useMemo(() => {
		const set = new Set<string>();
		for (const r of routes) {
			set.add(normalizeRouteGroup(r.route_group));
		}
		return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	}, [routes]);

	const routeGroupFilterOptions = useMemo(() => {
		const list = [...distinctRouteGroups];
		if (filterRouteGroup && !list.includes(filterRouteGroup)) {
			list.push(filterRouteGroup);
		}
		return list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	}, [distinctRouteGroups, filterRouteGroup]);

	const vendorFilterOptions = useMemo(
		() => buildVendorFilterOptions({ models, routes, modelMeta }),
		[models, routes, modelMeta]
	);

	const providerRouteCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const r of routes) {
			counts.set(r.provider_id, (counts.get(r.provider_id) ?? 0) + 1);
		}
		return counts;
	}, [routes]);

	const routeGroupCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const r of routes) {
			const g = normalizeRouteGroup(r.route_group);
			counts.set(g, (counts.get(g) ?? 0) + 1);
		}
		return counts;
	}, [routes]);

	const statusCounts = useMemo(() => {
		let active = 0;
		let inactive = 0;
		for (const r of routes) {
			if (r.status === 'active') active += 1;
			else inactive += 1;
		}
		return { all: routes.length, active, inactive };
	}, [routes]);

	const kindCounts = useMemo(() => {
		let llm = 0;
		let image = 0;
		let audio = 0;
		for (const m of models) {
			if (isImageGenerationModel(m)) image += 1;
			else if (isAudioModel(m)) audio += 1;
			else llm += 1;
		}
		return { all: models.length, llm, image, audio };
	}, [models]);

	const routesByModel = useMemo(
		() =>
			buildRoutesByModel({
				routes,
				models,
				modelMeta,
				filterVendor,
				filterProviderId,
				filterRouteGroup,
				filterStatus,
				filterKind,
			}),
		[
			routes,
			models,
			modelMeta,
			filterVendor,
			filterProviderId,
			filterRouteGroup,
			filterStatus,
			filterKind,
		]
	);

	const routeCards = useMemo(
		() => sortRouteCards(routesByModel, modelMeta),
		[routesByModel, modelMeta]
	);

	const routeCardVendorGroups = useMemo(
		() => buildRouteCardVendorGroups(routeCards, filterVendor),
		[routeCards, filterVendor]
	);

	const visibleModelCount = routesByModel.length;

	const visibleRouteCount = useMemo(
		() => routesByModel.reduce((sum, g) => sum + g.groupRoutes.length, 0),
		[routesByModel]
	);

	const hasActiveFilters = Boolean(
		filterVendor ||
		filterProviderId ||
		filterRouteGroup ||
		filterStatus ||
		filterKind !== DEFAULT_ROUTE_KIND_FILTER
	);

	const activeFilterSummary = useMemo(
		() =>
			buildActiveFilterSummary({
				filterStatus,
				filterRouteGroup,
				filterVendor,
				filterProviderId,
				providers,
			}),
		[filterStatus, filterRouteGroup, filterVendor, filterProviderId, providers]
	);

	const selectedProvider = useMemo(
		() => providers.find((p) => p.id === formData.provider_id),
		[providers, formData.provider_id]
	);

	const selectedModel = useMemo(
		() => models.find((m) => m.id === formData.model_id),
		[models, formData.model_id]
	);

	const selectedModelIsImage = useMemo(
		() => (selectedModel ? isImageRouteModel(selectedModel) : false),
		[selectedModel]
	);

	const selectedModelIsAudio = useMemo(
		() => (selectedModel ? isAudioRouteModel(selectedModel) : false),
		[selectedModel]
	);

	const catalogStandardTierRows = useMemo(() => {
		if (!selectedModel || selectedModelIsImage || selectedModelIsAudio) return [];
		return getCatalogPricingTierRows(selectedModel, billingCurrency);
	}, [selectedModel, selectedModelIsImage, selectedModelIsAudio, billingCurrency]);

	const catalogImagePricingDisplay = useMemo(() => {
		if (!selectedModel || !selectedModelIsImage) return null;
		return getCatalogImagePricingDisplay(selectedModel, billingCurrency);
	}, [selectedModel, selectedModelIsImage, billingCurrency]);

	const catalogAudioPricingDisplay = useMemo(() => {
		if (!selectedModel || !selectedModelIsAudio) return null;
		return getCatalogAudioPricingDisplay(selectedModel, billingCurrency);
	}, [selectedModel, selectedModelIsAudio, billingCurrency]);

	const allowedProtocolsForProvider = useMemo((): UpstreamProtocol[] => {
		if (!selectedProvider) return [];
		const supported = UPSTREAM_PROTOCOLS.filter(
			(proto) =>
				providerSupportsUpstreamProtocol(proto, selectedProvider) &&
				upstreamOperationsForProviderModel(
					selectedProvider,
					selectedModel,
					proto,
					formData.provider_model_name,
				).length > 0
		);
		return supported;
	}, [selectedProvider, selectedModel, formData.provider_model_name]);

	useEffect(() => {
		if (!showModal || !selectedProvider || allowedProtocolsForProvider.length === 0) return;
		setFormData((fd) => {
			if (allowedProtocolsForProvider.includes(fd.upstream_protocol)) return fd;
			const upstreamProtocol = allowedProtocolsForProvider[0]!;
			const upstreamOperations = upstreamOperationsForProviderModel(
				selectedProvider,
				selectedModel,
				upstreamProtocol,
				fd.provider_model_name,
			);
			return {
				...fd,
				upstream_protocol: upstreamProtocol,
				upstream_operation: upstreamOperations[0] ?? fd.upstream_operation,
			};
		});
	}, [
		showModal,
		formData.provider_id,
		formData.provider_model_name,
		selectedProvider,
		selectedModel,
		allowedProtocolsForProvider,
	]);

	useEffect(() => {
		if (!showModal) return;
		setFormData((fd) => {
			const adapters = compatibleAdaptersForRoute(fd);
			if (adapters.length === 0 || adapters.includes(fd.adapter)) return fd;
			// 只在当前 adapter 失效时自动选择，保留用户对 Qwen/MiniMax 的明确选择。
			return { ...fd, adapter: adapters[0]! };
		});
	}, [
		showModal,
		formData.request_protocol,
		formData.request_operation,
		formData.upstream_protocol,
		formData.upstream_operation,
	]);

	const clearAllFilters = useCallback(() => {
		setFilterKind(DEFAULT_ROUTE_KIND_FILTER);
		setFilterVendor('');
		setFilterProviderId('');
		setFilterRouteGroup('');
		setFilterStatus('');
	}, []);

	const handleCreate = useCallback(
		(presetModelId?: string, preset?: { protocol?: string; operation?: string; group?: string }) => {
			setEditingRoute(null);
			setDuplicateSourceRouteId(null);
			const initial = createInitialRouteForm(models, presetModelId);
			setFormData({
				...initial,
				upstream_protocol:
					preset?.protocol && UPSTREAM_PROTOCOLS.includes(preset.protocol as UpstreamProtocol)
						? (preset.protocol as UpstreamProtocol)
						: initial.upstream_protocol,
				request_protocol:
					preset?.protocol && UPSTREAM_PROTOCOLS.includes(preset.protocol as UpstreamProtocol)
						? (preset.protocol as UpstreamProtocol)
						: initial.request_protocol,
				request_operation: preset?.operation ?? initial.request_operation,
				upstream_operation: preset?.operation ?? initial.upstream_operation,
				route_group: preset?.group ?? initial.route_group,
			});
			setShowModal(true);
			setSaveError('');
		},
		[models]
	);

	const handleEdit = useCallback(
		(route: RouteListRow) => {
			setEditingRoute(route);
			setDuplicateSourceRouteId(null);
			setFormData(buildFormDataFromRoute(route, models));
			setShowModal(true);
			setSaveError('');
		},
		[models]
	);

	const handleDuplicate = useCallback(
		(route: RouteListRow) => {
			setEditingRoute(null);
			setDuplicateSourceRouteId(route.id);
			setFormData(buildFormDataFromRoute(route, models));
			setShowModal(true);
			setSaveError('');
		},
		[models]
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!confirm('Are you sure you want to delete this route?')) return;

			setIsDeleting(true);
			try {
				const result = await deleteRoute(id);
				if (result.success) {
					setShowModal(false);
					setEditingRoute(null);
					setDuplicateSourceRouteId(null);
					await refreshRoutesPage();
				} else {
					alert(result.message);
				}
			} catch (error) {
				console.error('Delete error:', error);
				alert('Delete failed');
			} finally {
				setIsDeleting(false);
			}
		},
		[refreshRoutesPage]
	);

	const handleToggleStatus = useCallback(async (route: RouteListRow) => {
		const newStatus = route.status === 'active' ? 'inactive' : 'active';
		setTogglingId(route.id);
		try {
			const result = await toggleRouteStatus(route.id, newStatus);
			if (result.success) {
				setRoutes((prev) =>
					prev.map((r) => (r.id === route.id ? { ...r, status: newStatus } : r))
				);
			} else {
				alert(result.message);
			}
		} catch (error) {
			console.error('Toggle status error:', error);
			alert('Update failed, please try again');
		} finally {
			setTogglingId(null);
		}
	}, []);

	const copyModelId = useCallback(async (modelId: string) => {
		try {
			await navigator.clipboard.writeText(modelId);
			setCopiedModelId(modelId);
			setTimeout(() => setCopiedModelId((current) => (current === modelId ? null : current)), 2000);
		} catch (error) {
			console.error('Copy model id failed:', error);
		}
	}, []);

	const handleSave = useCallback(async () => {
		setSaveError('');
		setIsSaving(true);
		try {
			const result = await saveRoute(formData, editingRoute);
			if (result.success) {
				setShowModal(false);
				setEditingRoute(null);
				setDuplicateSourceRouteId(null);
				await refreshRoutesPage();
			} else {
				setSaveError(result.message);
			}
		} catch (error) {
			console.error('Save error:', error);
			setSaveError(error instanceof Error ? error.message : 'Save failed, please try again');
		} finally {
			setIsSaving(false);
		}
	}, [editingRoute, formData, refreshRoutesPage]);

	const handleOpenStrategyDialog = useCallback(
		(
			modelId: string,
			modelTitle: string,
			protocol: string,
			protocolLabel: string,
			group: string,
			poolId?: string | null,
			poolStrategy?: string | null,
			requestOperation?: string,
			extras?: { priority?: number; poolTierStrategies?: string | null }
		) => {
			const raw = modelMeta.get(modelId)?.route_policy ?? null;
			const poolTierStrategies = extras?.poolTierStrategies ?? null;
			const priority = extras?.priority;
			const inherited = resolveEffectiveRouteStrategy({
				poolStrategy: priority !== undefined ? poolStrategy : null,
				poolTierStrategies: null,
				routePolicyRaw: raw,
				protocol,
				requestOperation,
				routeGroup: group,
				globalStrategy: globalRouteStrategy,
			});
			const matchingTargets = routes
				.filter((route) =>
					poolId
						? route.route_pool_id === poolId
						: route.model_id === modelId &&
							route.upstream_protocol === protocol &&
							normalizeRouteGroup(route.route_group) === normalizeRouteGroup(group)
				)
				.map((route) => ({
					id: route.id,
					providerId: route.provider_id,
					providerName:
						route.provider_name || providerMeta.get(route.provider_id)?.name || route.provider_id,
					providerModelName: route.provider_model_name,
					priority: route.priority,
					weight: route.weight ?? 1,
					active:
						route.status === 'active' &&
						providerMeta.get(route.provider_id)?.status !== 'disabled',
				}));
			const tierMap = parseRoutePoolTierStrategies(poolTierStrategies);
			const tierStrategy =
				priority !== undefined ? (tierMap.get(priority) ?? '') : '';
			setStrategyForm(
				poolId
					? {
							protocolStrategy: poolStrategy ?? '',
							tierStrategy,
							capabilityStrategies: {},
						}
					: readRoutePolicyFormFromRaw(raw, protocol, group)
			);
			setStrategyError('');
			setStrategyDialog({
				modelId,
				modelTitle,
				protocol,
				protocolLabel,
				group,
				poolId,
				poolStrategy,
				poolTierStrategies,
				priority,
				requestOperation,
				inheritedStrategy: inherited.strategy,
				inheritedSource: inherited.source,
				targets: matchingTargets,
			});
		},
		[globalRouteStrategy, modelMeta, providerMeta, routes]
	);

	const handleSaveStrategy = useCallback(async () => {
		if (!strategyDialog) return;
		setStrategySaving(true);
		setStrategyError('');
		try {
			let result: { success: true } | { success: false; message: string };
			if (strategyDialog.poolId) {
				if (strategyDialog.priority !== undefined) {
					const tierMap = parseRoutePoolTierStrategies(strategyDialog.poolTierStrategies);
					const next = strategyForm.tierStrategy.trim().toLowerCase();
					if (next && isRouteStrategyName(next)) {
						tierMap.set(strategyDialog.priority, next);
					} else {
						tierMap.delete(strategyDialog.priority);
					}
					const tierObj: Record<string, string> = {};
					for (const [priority, strategy] of tierMap) {
						tierObj[String(priority)] = strategy;
					}
					// Tier dialog only mutates per-priority overrides; pool/global stay elsewhere.
					result = await patchRoutePoolPolicy(strategyDialog.poolId, {
						tier_strategies: Object.keys(tierObj).length > 0 ? tierObj : null,
					});
				} else {
					result = await patchRoutePoolPolicy(strategyDialog.poolId, {
						strategy: strategyForm.protocolStrategy || null,
					});
				}
			} else {
				result = await patchModelRoutePolicy(
					strategyDialog.modelId,
					buildRoutePolicyPatch(
						modelMeta.get(strategyDialog.modelId)?.route_policy ?? null,
						strategyDialog.protocol,
						strategyDialog.group,
						strategyForm
					)
				);
			}
			if (!result.success) {
				setStrategyError(result.message);
				return;
			}
			setStrategyDialog(null);
			await refreshRoutesPage();
		} catch (error) {
			setStrategyError(error instanceof Error ? error.message : 'Save failed, please try again');
		} finally {
			setStrategySaving(false);
		}
	}, [modelMeta, refreshRoutesPage, strategyDialog, strategyForm]);

	const handleOpenProviderStickyDialog = useCallback(
		(
			modelId: string,
			modelTitle: string,
			protocol: string,
			protocolLabel: string,
			group: string,
			requestOperation: string,
			poolId: string | null,
			enabled: boolean,
			idleTtlSeconds: number,
			targets: Array<{ id: string; providerName: string; priority: number; weight: number }> = []
		) => {
			setStickyForm({
				enabled,
				idleTtlSeconds: Number.isFinite(idleTtlSeconds)
					? idleTtlSeconds
					: DEFAULT_STICKY_IDLE_TTL_SECONDS,
			});
			setStickyError('');
			setStickyDialog({
				modelId,
				modelTitle,
				protocol,
				protocolLabel,
				group,
				requestOperation,
				poolId,
				enabled,
				idleTtlSeconds: Number.isFinite(idleTtlSeconds)
					? idleTtlSeconds
					: DEFAULT_STICKY_IDLE_TTL_SECONDS,
				targets,
			});
		},
		[]
	);

	const handleSaveProviderSticky = useCallback(async () => {
		if (!stickyDialog?.poolId) return;
		setStickySaving(true);
		setStickyError('');
		try {
			const result = await patchRoutePoolPolicy(stickyDialog.poolId, {
				sticky_routing: {
					enabled: stickyForm.enabled,
					idle_ttl_seconds: stickyForm.idleTtlSeconds,
				},
			});
			if (!result.success) {
				setStickyError(result.message);
				return;
			}
			setStickyDialog(null);
			await refreshRoutesPage();
		} catch (error) {
			setStickyError(error instanceof Error ? error.message : 'Save failed, please try again');
		} finally {
			setStickySaving(false);
		}
	}, [refreshRoutesPage, stickyDialog, stickyForm]);

	const closeRouteModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	const closeStrategyDialog = useCallback(() => {
		if (strategySaving) return;
		setStrategyDialog(null);
	}, [strategySaving]);

	const closeStickyDialog = useCallback(() => {
		if (stickySaving) return;
		setStickyDialog(null);
	}, [stickySaving]);

	return {
		isLoading,
		routes,
		models,
		providers,
		globalRouteStrategy,
		modelMeta,
		providerMeta,
		billingCurrency,
		filterVendor,
		setFilterVendor,
		filterProviderId,
		setFilterProviderId,
		filterRouteGroup,
		setFilterRouteGroup,
		filterStatus,
		setFilterStatus,
		filterKind,
		setFilterKind,
		hasActiveFilters,
		clearAllFilters,
		activeFilterSummary,
		visibleModelCount,
		visibleRouteCount,
		statusCounts,
		kindCounts,
		routeGroupFilterOptions,
		routeGroupCounts,
		vendorFilterOptions,
		providerRouteCounts,
		routesByModel,
		routeCards,
		routeCardVendorGroups,
		showModal,
		setShowModal,
		editingRoute,
		duplicateSourceRouteId,
		formData,
		setFormData,
		saveError,
		isSaving,
		isDeleting,
		togglingId,
		copiedModelId,
		selectedProvider,
		selectedModel,
		catalogStandardTierRows,
		catalogImagePricingDisplay,
		catalogAudioPricingDisplay,
		selectedModelIsImage,
		selectedModelIsAudio,
		allowedProtocolsForProvider,
		businessTimezone,
		strategyDialog,
		setStrategyDialog,
		strategyForm,
		setStrategyForm,
		strategySaving,
		strategyError,
		stickyDialog,
		stickyForm,
		setStickyForm,
		stickySaving,
		stickyError,
		handleCreate,
		handleEdit,
		handleDuplicate,
		handleDelete,
		handleToggleStatus,
		copyModelId,
		handleSave,
		handleOpenStrategyDialog,
		handleSaveStrategy,
		handleOpenProviderStickyDialog,
		handleSaveProviderSticky,
		closeRouteModal,
		closeStrategyDialog,
		closeStickyDialog,
		refreshRoutesPage,
		modelEdit,
	};
}
