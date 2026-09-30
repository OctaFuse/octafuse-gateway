'use client';

import { useEffect, useRef, useState } from 'react';
import {
	ArrowsRightLeftIcon,
	BanknotesIcon,
	BeakerIcon,
	ChevronRightIcon,
	CodeBracketIcon,
	DocumentDuplicateIcon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { useTranslations, useLocale } from 'next-intl';
import { liveProviderPickerLabel } from '@/lib/provider-kind';
import {
	alignRouteScheduleWindowsToCatalog,
	buildRoutePriceOverride,
	catalogScheduleWindowsFromModel,
	composeCustomParamsJson,
	customHeaderRowsHaveValues,
} from '../route-utils';
import { RouteMappingFields } from './route-mapping-fields';
import { RouteRequestFields } from './route-request-fields';
import { RouteQuickTest } from './route-quick-test';
import { RoutePricingFields } from './route-pricing-fields';
import type { RouteModalProps } from './route-modal-types';

type EditorTab = 'mapping' | 'request' | 'pricing' | 'test';
const TABS = [
	{ id: 'mapping', icon: ArrowsRightLeftIcon },
	{ id: 'request', icon: CodeBracketIcon },
	{ id: 'pricing', icon: BanknotesIcon },
	{ id: 'test', icon: BeakerIcon },
] as const;

export function RouteModal(props: RouteModalProps) {
	if (!props.open) return null;
	return (
		<RouteModalContent
			key={`${props.editingRoute?.id ?? 'new'}:${props.duplicateSourceRouteId ?? ''}`}
			{...props}
		/>
	);
}

function RouteModalContent(props: RouteModalProps) {
	const {
		editingRoute,
		duplicateSourceRouteId,
		formData,
		selectedModel,
		selectedProvider,
		saveError,
		isSaving,
		isDeleting,
		onClose,
		onSave,
		onDelete,
		onDuplicate,
	} = props;
	const t = useTranslations('routes.modal');
	const tCommon = useTranslations('common');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const [activeTab, setActiveTab] = useState<EditorTab>('mapping');
	const [validationError, setValidationError] = useState('');
	const dialogRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const tabRefs = useRef<Partial<Record<EditorTab, HTMLButtonElement | null>>>({});
	const busy = isSaving || isDeleting;
	const editorProps = {
		...props,
		onFormChange: (form: RouteModalProps['formData']) => {
			setValidationError('');
			props.onFormChange(form);
		},
	};
	const hasCustomParams =
		customHeaderRowsHaveValues(formData.custom_headers) ||
		Boolean(formData.custom_params_json.trim()) ||
		formData.custom_params_force_override_headers ||
		formData.custom_params_force_override_body;
	const headerCount = formData.custom_headers.filter((row) => row.name.trim()).length;
	const scheduleCount =
		catalogScheduleWindowsFromModel(selectedModel).length || formData.schedule_windows.length;
	const providerLabel = selectedProvider
		? liveProviderPickerLabel(selectedProvider, locale, tKind('custom'), selectedProvider.id)
		: t('selectProvider');
	const modelLabel = selectedModel?.display_name || formData.model_id;
	const routeContext = `${providerLabel}\n${t('routeGroup')}: ${formData.route_group.trim() || 'default'}`;
	const requestSummary = hasCustomParams
		? [
				headerCount ? t('editor.headerCount', { count: headerCount }) : '',
				formData.custom_params_json.trim() ? t('customBody') : '',
				formData.custom_params_force_override_headers || formData.custom_params_force_override_body
					? t('customBodyForceOverride')
					: '',
		  ]
				.filter(Boolean)
				.join(' · ')
		: t('editor.requestDefault');

	useEffect(() => {
		const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		tabRefs.current.mapping?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			if (previousFocus?.isConnected) previousFocus.focus();
		};
	}, []);

	function selectTab(id: EditorTab, focus = false) {
		setActiveTab(id);
		scrollRef.current?.scrollTo({ top: 0 });
		if (focus) tabRefs.current[id]?.focus();
	}

	function handleSave() {
		setValidationError('');
		if (!formData.model_id || !formData.provider_id || !formData.provider_model_name.trim()) {
			selectTab('mapping', true);
			setValidationError(t('editor.requiredFields'));
			return;
		}
		// Reuse the save validators to reveal an invalid field even when its tab is hidden.
		try {
			buildRoutePriceOverride({
				...formData,
				schedule_windows: alignRouteScheduleWindowsToCatalog(
					catalogScheduleWindowsFromModel(selectedModel),
					formData.schedule_windows
				),
			});
		} catch (error) {
			selectTab('pricing', true);
			setValidationError(error instanceof Error ? error.message : tCommon('saveFailed'));
			return;
		}
		try {
			composeCustomParamsJson(formData.custom_params_json, formData.custom_headers, {
				headers: formData.custom_params_force_override_headers,
				body: formData.custom_params_force_override_body,
			});
		} catch (error) {
			selectTab('request', true);
			setValidationError(error instanceof Error ? error.message : tCommon('saveFailed'));
			return;
		}
		onSave();
	}

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-2 sm:p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="route-modal-title"
				aria-describedby={modelLabel ? 'route-modal-context' : undefined}
				className="flex h-[min(840px,94dvh)] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
				onKeyDown={(event) => {
					if (event.key === 'Escape' && !busy) {
						event.stopPropagation();
						onClose();
					}
					if (event.key !== 'Tab') return;
					const focusable = Array.from(
						dialogRef.current?.querySelectorAll<HTMLElement>(
							'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
						) ?? []
					).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					}
					if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
			>
				<header className="shrink-0 px-5 pt-5 sm:px-6">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0 flex-1">
							<h2
								id="route-modal-title"
								className="flex min-w-0 items-baseline gap-3 text-lg font-semibold text-gray-900"
							>
								<span className="shrink-0">{editingRoute ? t('editTitle') : t('newTitle')}</span>
								{modelLabel ? (
									<span
										className="min-w-0 truncate border-l border-gray-200 pl-3 text-sm font-normal text-gray-500"
										title={`${modelLabel}\n${routeContext}`}
									>
										{modelLabel}
									</span>
								) : null}
							</h2>
							{modelLabel ? (
								<p id="route-modal-context" className="sr-only">
									{routeContext}
								</p>
							) : null}
							{!editingRoute && duplicateSourceRouteId ? (
								<p className="truncate text-xs text-gray-400">
									{t('prefilledFrom', { id: duplicateSourceRouteId })}
								</p>
							) : null}
						</div>
						<button
							type="button"
							onClick={onClose}
							disabled={busy}
							aria-label={tCommon('close')}
							className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<XMarkIcon className="h-5 w-5" aria-hidden />
						</button>
					</div>
					<div
						role="tablist"
						aria-label={t('editor.sections')}
						className="mt-4 flex gap-4 overflow-x-auto sm:gap-7"
					>
						{TABS.map(({ id, icon: Icon }, index) => (
							<button
								key={id}
								ref={(el) => {
									tabRefs.current[id] = el;
								}}
								type="button"
								role="tab"
								id={`route-tab-${id}`}
								aria-controls={`route-panel-${id}`}
								aria-selected={activeTab === id}
								tabIndex={activeTab === id ? 0 : -1}
								onClick={() => selectTab(id)}
								onKeyDown={(event) => {
									let next = index;
									if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
									else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length;
									else if (event.key === 'Home') next = 0;
									else if (event.key === 'End') next = TABS.length - 1;
									else return;
									event.preventDefault();
									selectTab(TABS[next].id, true);
								}}
								className={`flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
									activeTab === id
										? 'border-blue-600 text-blue-700'
										: 'border-transparent text-gray-500 hover:text-gray-800'
								}`}
							>
								<Icon className="hidden h-4 w-4 sm:block" aria-hidden />
								{t(`editor.tabs.${id}`)}
								{id === 'request' && hasCustomParams ? (
									<span
										className="h-1.5 w-1.5 rounded-full bg-blue-500"
										aria-label={t('editor.configured')}
									/>
								) : null}
								{id === 'pricing' && scheduleCount > 0 ? (
									<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-600">
										{scheduleCount}
									</span>
								) : null}
							</button>
						))}
					</div>
				</header>
				{saveError || validationError ? (
					<div
						role="alert"
						className="shrink-0 border-t border-red-200 bg-red-50 px-6 py-2.5 text-sm text-red-700"
					>
						{validationError || saveError}
					</div>
				) : null}
				<div
					ref={scrollRef}
					className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-gray-200 bg-slate-100/80 px-5 py-4 sm:px-6"
				>
					<fieldset disabled={busy} className="min-w-0">
						<div
							role="tabpanel"
							id="route-panel-mapping"
							aria-labelledby="route-tab-mapping"
							hidden={activeTab !== 'mapping'}
							tabIndex={0}
							className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<RouteMappingFields {...editorProps} />
							<div className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
								{(['request', 'pricing'] as const).map((id) => (
									<button
										key={id}
										type="button"
										onClick={() => selectTab(id, true)}
										className="group flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
									>
										<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
											<p className="text-xs font-medium text-gray-600">{t(`editor.tabs.${id}`)}</p>
											<p className="truncate text-xs text-gray-400">
												{id === 'request'
													? requestSummary
													: t('editor.pricingSummary', {
															charged: formData.charged_factor.trim() || '1',
															metered: formData.metered_factor.trim() || '1',
															count: scheduleCount,
													  })}
											</p>
										</div>
										<ChevronRightIcon
											className="h-4 w-4 shrink-0 text-gray-400 group-hover:text-blue-500"
											aria-hidden
										/>
									</button>
								))}
							</div>
						</div>
						<div
							role="tabpanel"
							id="route-panel-request"
							aria-labelledby="route-tab-request"
							hidden={activeTab !== 'request'}
							tabIndex={0}
							className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<RouteRequestFields {...editorProps} />
						</div>
						<div
							role="tabpanel"
							id="route-panel-pricing"
							aria-labelledby="route-tab-pricing"
							hidden={activeTab !== 'pricing'}
							tabIndex={0}
							className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<RoutePricingFields {...editorProps} />
						</div>
						<div
							role="tabpanel"
							id="route-panel-test"
							aria-labelledby="route-tab-test"
							hidden={activeTab !== 'test'}
							tabIndex={0}
							className="outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<RouteQuickTest {...editorProps} />
						</div>
					</fieldset>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-white px-5 py-4 sm:px-6">
					<div className="flex flex-wrap items-center gap-2">
						{editingRoute && (
							<>
								<button
									type="button"
									onClick={onDelete}
									disabled={isSaving || isDeleting}
									className="inline-flex items-center gap-1.5 rounded-md border border-transparent bg-transparent px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<TrashIcon className="h-4 w-4" aria-hidden />
									{isDeleting ? tCommon('deleting') : t('deleteRoute')}
								</button>
							</>
						)}
					</div>
					<div className="ml-auto flex gap-2 sm:gap-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={isSaving || isDeleting}
						>
							{tCommon('cancel')}
						</button>
						{editingRoute && (
							<button
								type="button"
								onClick={onDuplicate}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon('duplicate')}
							</button>
						)}
						<button
							type="button"
							onClick={handleSave}
							disabled={isSaving || isDeleting}
							className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving ? tCommon('savingDots') : tCommon('save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
