'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import {
	parseModelStickyConfig,
	stickyRuleKey,
} from '@octafuse/core/db/model-sticky-config';
import { useBusinessTimezone } from '@/components/BusinessTimezoneProvider';
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
	DEFAULT_KIND_FILTER,
	parseKindFilterParam,
	type ModelKindFilter,
} from '../models/types';
import { useModelEditModal } from '../models/use-model-edit-modal';
import {
	deleteRoute,
	fetchRoutesPageData,
	patchModelStickyConfig,
	saveRoute,
	toggleRouteStatus,
} from './route-api';
import {
	buildActiveFilterSummary,
	buildFormDataFromRoute,
	buildRouteCardVendorGroups,
	buildRoutesByModel,
	buildStickyConfigPatch,
	buildVendorFilterOptions,
	createInitialRouteForm,
	sortRouteCards,
} from './route-utils';
import {
	EMPTY_ROUTE_FORM,
	type RouteFormData,
	type RouteListRow,
	type StickyDialogState,
	type StickyFormState,
} from './types';

export function useRoutesPageState() {
	const searchParams = useSearchParams();
	const [routes, setRoutes] = useState<RouteListRow[]>([]);
	const [models, setModels] = useState<GatewayModel[]>([]);
	const [providers, setProviders] = useState<GatewayProvider[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editingRoute, setEditingRoute] = useState<RouteListRow | null>(null);
	const [duplicateSourceRouteId, setDuplicateSourceRouteId] = useState<string | null>(null);
	const [formData, setFormData] = useState<RouteFormData>(EMPTY_ROUTE_FORM);
	const [filterVendor, setFilterVendor] = useState('');
	const [filterProviderId, setFilterProviderId] = useState('');
	const [filterRouteGroup, setFilterRouteGroup] = useState('');
	const [filterStatus, setFilterStatus] = useState('');
	const [filterKind, setFilterKind] = useState<ModelKindFilter>(DEFAULT_KIND_FILTER);
	const [saveError, setSaveError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [togglingId, setTogglingId] = useState<string | null>(null);
	const [copiedModelId, setCopiedModelId] = useState<string | null>(null);
	const [stickyDialog, setStickyDialog] = useState<StickyDialogState | null>(null);
	const [stickyForm, setStickyForm] = useState<StickyFormState>({
		enabled: false,
		ttl_seconds: '',
		short_wait_ms: '',
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
		setFilterKind(parseKindFilterParam(kind));
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
		for (const m of models) {
			if (isImageGenerationModel(m)) image += 1;
			else llm += 1;
		}
		return { llm, image };
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
		filterVendor || filterProviderId || filterRouteGroup || filterStatus
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

	const catalogStandardTierRows = useMemo(() => {
		if (!selectedModel || selectedModelIsImage) return [];
		return getCatalogPricingTierRows(selectedModel, billingCurrency);
	}, [selectedModel, selectedModelIsImage, billingCurrency]);

	const catalogImagePricingDisplay = useMemo(() => {
		if (!selectedModel || !selectedModelIsImage) return null;
		return getCatalogImagePricingDisplay(selectedModel, billingCurrency);
	}, [selectedModel, selectedModelIsImage, billingCurrency]);

	const allowedProtocolsForProvider = useMemo((): UpstreamProtocol[] => {
		if (!selectedProvider) return [];
		const supported = UPSTREAM_PROTOCOLS.filter((proto) =>
			providerSupportsUpstreamProtocol(proto, selectedProvider)
		);
		if (selectedModelIsImage) {
			return supported.includes('openai') ? ['openai'] : [];
		}
		return supported;
	}, [selectedProvider, selectedModelIsImage]);

	useEffect(() => {
		if (!showModal || !selectedProvider || allowedProtocolsForProvider.length === 0) return;
		setFormData((fd) => {
			if (allowedProtocolsForProvider.includes(fd.upstream_protocol)) return fd;
			return { ...fd, upstream_protocol: allowedProtocolsForProvider[0]! };
		});
	}, [showModal, formData.provider_id, selectedProvider, allowedProtocolsForProvider]);

	useEffect(() => {
		if (!showModal || !selectedModelIsImage) return;
		setFormData((fd) =>
			fd.upstream_protocol === 'openai' ? fd : { ...fd, upstream_protocol: 'openai' }
		);
	}, [showModal, selectedModelIsImage, formData.model_id]);

	const clearAllFilters = useCallback(() => {
		setFilterVendor('');
		setFilterProviderId('');
		setFilterRouteGroup('');
		setFilterStatus('');
	}, []);

	const handleCreate = useCallback(
		(presetModelId?: string) => {
			setEditingRoute(null);
			setDuplicateSourceRouteId(null);
			setFormData(createInitialRouteForm(models, presetModelId));
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

	const handleOpenStickyDialog = useCallback(
		(
			modelId: string,
			modelTitle: string,
			protocol: string,
			protocolLabel: string,
			group: string
		) => {
			const raw = modelMeta.get(modelId)?.sticky_config ?? null;
			const parsed = parseModelStickyConfig(raw);
			const rule = parsed?.rules.get(stickyRuleKey(protocol, group)) ?? null;
			setStickyForm({
				enabled: Boolean(rule?.enabled),
				ttl_seconds: rule?.ttlSeconds != null ? String(rule.ttlSeconds) : '',
				short_wait_ms: rule?.shortWaitMs != null ? String(rule.shortWaitMs) : '',
			});
			setStickyError('');
			setStickyDialog({ modelId, modelTitle, protocol, protocolLabel, group });
		},
		[modelMeta]
	);

	const handleSaveSticky = useCallback(async () => {
		if (!stickyDialog) return;
		const ttl = stickyForm.ttl_seconds.trim() === '' ? null : parseInt(stickyForm.ttl_seconds, 10);
		const wait = stickyForm.short_wait_ms.trim() === '' ? null : parseInt(stickyForm.short_wait_ms, 10);
		if (stickyForm.enabled) {
			if (ttl != null && (!Number.isFinite(ttl) || ttl <= 0)) {
				setStickyError('Idle TTL must be a positive integer (seconds)');
				return;
			}
			if (wait != null && (!Number.isFinite(wait) || wait <= 0)) {
				setStickyError('Short wait must be a positive integer (ms)');
				return;
			}
		}
		setStickySaving(true);
		setStickyError('');
		try {
			const raw = modelMeta.get(stickyDialog.modelId)?.sticky_config ?? null;
			const nextStickyConfig = buildStickyConfigPatch(
				raw,
				stickyDialog.protocol,
				stickyDialog.group,
				stickyForm,
				ttl,
				wait
			);
			const result = await patchModelStickyConfig(stickyDialog.modelId, nextStickyConfig);
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
	}, [modelMeta, refreshRoutesPage, stickyDialog, stickyForm]);

	const closeRouteModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	const closeStickyDialog = useCallback(() => {
		if (stickySaving) return;
		setStickyDialog(null);
	}, [stickySaving]);

	return {
		isLoading,
		routes,
		models,
		providers,
		modelMeta,
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
		selectedModelIsImage,
		allowedProtocolsForProvider,
		businessTimezone,
		stickyDialog,
		setStickyDialog,
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
		handleOpenStickyDialog,
		handleSaveSticky,
		closeRouteModal,
		closeStickyDialog,
		refreshRoutesPage,
		modelEdit,
	};
}
