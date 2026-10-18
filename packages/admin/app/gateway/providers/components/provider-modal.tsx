"use client";

import {
	ClipboardDocumentIcon,
	CodeBracketIcon,
	DocumentDuplicateIcon,
	EyeIcon,
	EyeSlashIcon,
	TrashIcon,
	XMarkIcon,
	InformationCircleIcon,
	AdjustmentsHorizontalIcon,
	ShareIcon,
} from "@heroicons/react/24/outline";
import { CheckIcon } from "@heroicons/react/24/solid";
import { useTranslations, useLocale } from "next-intl";
import {
	getStaticProviderPresetByKind,
	providerPresetCatalogCopy,
} from "@/lib/provider-import-preset";
import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import {
	providerApiKeyPreview,
	getProtocolEndpointMode,
	getSelectedProtocolCapabilities,
	toggleProtocolCapability,
	suggestProtocolEndpointUrl,
	protocolFormHasOverrides,
	switchProtocolEndpointMode,
	protocolFormIsConfigured,
} from "../provider-utils";
import {
	listProviderKindChoices,
	resolveStoredProviderPresentation,
} from "@/lib/provider-import-preset";
import {
	CUSTOM_PROVIDER_KIND,
	pickProviderCatalogText,
	pickProviderKindLabel,
} from "@/lib/provider-kind";
import { InfoHintPopover } from "@/components/InfoHintPopover";
import { VendorIcon } from "@/components/model-vendor-icon";
import type { UpstreamProtocol } from "@octafuse/core/upstream-protocol";
import type {
	GatewayProvider,
	ProtocolEndpointForm,
	ProviderFormData,
} from "../types";
import { ProviderCatalogOutboundLink } from "./provider-catalog-outbound-link";
import { useProviderRoutes } from "../use-provider-routes";
import { ProviderEndpointsJsonPreview } from "./provider-endpoints-json-preview";
import { ProviderRelatedRoutes } from "./provider-related-routes";
import { ProviderProtocolIcon } from "./provider-protocol-icon";
import { PROVIDER_ENDPOINT_FIELDS } from "../provider-endpoint-fields";

type ProviderModalProps = {
	open: boolean;
	editingProvider: GatewayProvider | null;
	duplicateSourceId: string | null;
	formData: ProviderFormData;
	saveError: string;
	isSaving: boolean;
	isApiKeyLoading: boolean;
	isDeleting: boolean;
	onClose: () => void;
	onFormChange: (form: ProviderFormData) => void;
	onSave: () => void;
	onDelete: (id: string) => void;
	onDuplicate: (provider: GatewayProvider) => void;
	onRoutesChanged: () => Promise<void>;
};

const inputClass =
	"w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500";

const PROTOCOL_TABS: Array<{
	key: UpstreamProtocol;
	labelKey:
		| "openaiOptional"
		| "anthropicOptional"
		| "geminiOptional"
		| "dashscopeOptional"
		| "minimaxOptional"
		| "volcengineOptional"
		| "elevenlabsOptional";
}> = [
	{ key: "openai", labelKey: "openaiOptional" },
	{ key: "anthropic", labelKey: "anthropicOptional" },
	{ key: "gemini", labelKey: "geminiOptional" },
	{ key: "dashscope", labelKey: "dashscopeOptional" },
	{ key: "minimax", labelKey: "minimaxOptional" },
	{ key: "volcengine", labelKey: "volcengineOptional" },
	{ key: "elevenlabs", labelKey: "elevenlabsOptional" },
];

/** Arrow/Home/End navigation for both levels of tabs. */
function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
	if (
		![
			"ArrowLeft",
			"ArrowRight",
			"ArrowUp",
			"ArrowDown",
			"Home",
			"End",
		].includes(event.key)
	)
		return;
	const tabs = Array.from(
		event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
			'[role="tab"]'
		) ?? []
	);
	if (!tabs.length) return;
	const index = tabs.indexOf(event.currentTarget);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
			? tabs.length - 1
			: (index +
					(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) +
					tabs.length) %
			  tabs.length;
	event.preventDefault();
	tabs[next].focus();
	tabs[next].click();
}

function EndpointUrlField({
	id,
	name,
	path,
	description,
	value,
	placeholder,
	websocket,
	suggestedUrl,
	onChange,
}: {
	id: string;
	name: string;
	path: string;
	description: string;
	value: string;
	placeholder: string;
	websocket?: boolean;
	suggestedUrl?: string | null;
	onChange: (value: string) => void;
}) {
	const t = useTranslations("providers.modal");
	const filled = Boolean(value.trim());
	return (
		<div className="min-w-0 px-4 py-4">
			<div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
				<label htmlFor={id} className="text-sm font-medium text-gray-800">
					{name}
				</label>
				<InfoHintPopover
					label={t("capabilityHelp", { name })}
					openOnHover
					openOnFocus
					portal
					align="start"
				>
					<p className="leading-5">{description}</p>
				</InfoHintPopover>
				<code
					id={`${id}-path`}
					className={`ml-auto break-all rounded px-1.5 py-0.5 text-[11px] font-medium leading-5 ${
						filled ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
					}`}
				>
					{websocket ? "WSS " : ""}
					{path}
				</code>
			</div>
			<input
				id={id}
				aria-describedby={`${id}-path`}
				type="url"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className={`w-full rounded-lg border px-3 py-2.5 font-mono text-[13px] leading-5 text-gray-900 transition-colors placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100 ${
					filled
						? "border-blue-200 bg-blue-50/30"
						: "border-gray-200 bg-white hover:border-gray-300"
				}`}
				autoComplete="off"
				spellCheck={false}
				placeholder={placeholder}
			/>
			{!filled && suggestedUrl ? (
				<button
					type="button"
					onClick={() => onChange(suggestedUrl)}
					title={suggestedUrl}
					className="mt-2 rounded text-xs font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					{t("useBaseUrlEndpoint")}
				</button>
			) : null}
		</div>
	);
}

function ProtocolFields({
	form,
	protocol,
	onChange,
}: {
	form: ProtocolEndpointForm;
	protocol: UpstreamProtocol;
	onChange: (next: ProtocolEndpointForm) => void;
}) {
	const t = useTranslations("providers.modal");
	const mode = getProtocolEndpointMode(protocol, form);
	const hasMixedConfig =
		!form.mode &&
		Boolean(form.base.trim()) &&
		protocolFormHasOverrides(protocol, form);
	const selectedCapabilities = getSelectedProtocolCapabilities(protocol, form);
	const updatePartial = (next: ProtocolEndpointForm) =>
		onChange({
			...next,
			mode: "partial",
			selectedCapabilities,
		});
	const panelId = useId();
	const baseNote =
		protocol === "gemini"
			? t("geminiHint")
			: protocol === "dashscope"
			? t("dashscopeHint")
			: protocol === "elevenlabs"
			? t("elevenlabsHint")
			: null;

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
				<fieldset className="shrink-0">
					<legend className="sr-only">{t("endpointMode")}</legend>
					<div className="inline-flex gap-1 rounded-lg bg-gray-100 p-1">
						{(["all", "partial"] as const).map((value) => (
							<label
								key={value}
								className={`relative cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
									mode === value
										? "bg-white text-blue-700 shadow-sm ring-1 ring-gray-200/80"
										: "text-gray-500 hover:text-gray-800"
								}`}
							>
								<input
									type="radio"
									name={`${panelId}-mode`}
									value={value}
									checked={mode === value}
									onChange={() =>
										onChange(switchProtocolEndpointMode(protocol, form, value))
									}
									className="peer sr-only"
									aria-describedby={`${panelId}-mode-hint`}
								/>
								<span
									className="absolute inset-0 rounded-md peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500"
									aria-hidden
								/>
								{t(value === "all" ? "allCapabilities" : "partialCapabilities")}
							</label>
						))}
					</div>
				</fieldset>
				<p
					id={`${panelId}-mode-hint`}
					className="text-xs leading-5 text-gray-500"
				>
					{t(mode === "all" ? "baseUrlHint" : "partialCapabilitiesHint")}
				</p>
			</div>
			{hasMixedConfig ? (
				<p className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
					{t("mixedEndpointConfigHint")}
				</p>
			) : null}
			{mode === "all" ? (
				<div className="px-4 py-5">
					<label
						htmlFor={`${panelId}-base`}
						className="mb-2.5 block text-sm font-semibold text-gray-800"
					>
						{t("baseUrl")}
					</label>
					<input
						id={`${panelId}-base`}
						type="url"
						value={form.base}
						onChange={(event) =>
							onChange({ ...form, base: event.target.value })
						}
						className="w-full rounded-lg border border-blue-200 bg-blue-50/30 px-3 py-2.5 font-mono text-[13px] leading-5 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
						placeholder={t(`${protocol}Placeholder`)}
						autoComplete="off"
						spellCheck={false}
					/>
					{baseNote ? (
						<p className="mt-2 text-xs leading-5 text-gray-500">{baseNote}</p>
					) : null}
				</div>
			) : (
				<div>
					<fieldset className="border-b border-gray-100 px-4 py-4">
						<legend className="sr-only">{t("selectCapabilities")}</legend>
						<div className="flex flex-wrap gap-2">
							{PROVIDER_ENDPOINT_FIELDS[protocol].map(
								({ capability, description }) => {
									const checked = selectedCapabilities.includes(capability);
									return (
										<label
											key={capability}
											title={t(`endpointCapabilities.${description}`)}
											className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
												checked
													? "border-blue-200 bg-blue-50 text-blue-700"
													: "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
											}`}
										>
											<input
												type="checkbox"
												checked={checked}
												onChange={(event) =>
													onChange(
														toggleProtocolCapability(
															protocol,
															form,
															capability,
															event.target.checked
														)
													)
												}
												className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
											/>
											{t(`endpointCapabilityLabels.${description}`)}
										</label>
									);
								}
							)}
						</div>
					</fieldset>
					{selectedCapabilities.length === 0 ? (
						<p className="px-4 py-8 text-center text-sm text-gray-400">
							{t("noCapabilitiesSelected")}
						</p>
					) : null}
					<div className="divide-y divide-gray-100">
						{protocol === "gemini" &&
						form.legacyPerAction &&
						selectedCapabilities.includes("models.generate") ? (
							<>
								<p className="mx-4 my-3 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
									{t("legacyPerActionNotice")}
								</p>
								{(["generateContent", "streamGenerateContent"] as const).map(
									(action) => (
										<EndpointUrlField
											key={action}
											id={`${panelId}-${action}`}
											name={t(
												`endpointCapabilityLabels.${
													action === "generateContent"
														? "geminiGenerate"
														: "geminiStream"
												}`
											)}
											path={`/{model}:${action}`}
											description={t(
												`endpointCapabilities.${
													action === "generateContent"
														? "geminiGenerate"
														: "geminiStream"
												}`
											)}
											value={form.legacyPerAction?.[action] ?? ""}
											suggestedUrl={suggestProtocolEndpointUrl(
												protocol,
												form.base,
												"models.generate",
												action
											)}
											placeholder={t("endpointUrlPlaceholder")}
											onChange={(value) =>
												updatePartial({
													...form,
													legacyPerAction: {
														...form.legacyPerAction!,
														[action]: value,
													},
												})
											}
										/>
									)
								)}
							</>
						) : null}
						{PROVIDER_ENDPOINT_FIELDS[protocol]
							.filter(
								({ field, capability }) =>
									selectedCapabilities.includes(capability) &&
									!(
										protocol === "gemini" &&
										form.legacyPerAction &&
										field === "modelsGenerate"
									)
							)
							.map(({ field, capability, path, description, websocket }) => (
								<EndpointUrlField
									key={field}
									id={`${panelId}-${field}`}
									name={t(`endpointCapabilityLabels.${description}`)}
									path={path}
									description={t(`endpointCapabilities.${description}`)}
									value={form[field]}
									suggestedUrl={suggestProtocolEndpointUrl(
										protocol,
										form.base,
										capability
									)}
									placeholder={t("endpointUrlPlaceholder")}
									websocket={websocket}
									onChange={(value) =>
										updatePartial({ ...form, [field]: value })
									}
								/>
							))}
					</div>
				</div>
			)}
			{protocol === "gemini" ? (
				<div className="border-t border-gray-200 bg-gray-50/50 px-4 py-4">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
						<label
							htmlFor={`${panelId}-auth`}
							className="shrink-0 text-xs font-medium text-gray-700"
						>
							{t("geminiAuth")}
						</label>
						<select
							id={`${panelId}-auth`}
							value={form.auth}
							onChange={(event) =>
								onChange({
									...form,
									auth:
										event.target.value === "query-key" ||
										event.target.value === "bearer"
											? event.target.value
											: "auto",
								})
							}
							className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
						>
							<option value="auto">{t("geminiAuthAuto")}</option>
							<option value="query-key">{t("geminiAuthQueryKey")}</option>
							<option value="bearer">{t("geminiAuthBearer")}</option>
						</select>
					</div>
					<p className="mt-2 text-xs leading-5 text-gray-500">
						{t("geminiAuthHint")}
					</p>
				</div>
			) : null}
		</div>
	);
}

export function ProviderModal(props: ProviderModalProps) {
	const {
		open,
		editingProvider,
		duplicateSourceId,
		formData,
		saveError,
		isSaving,
		isApiKeyLoading,
		isDeleting,
		onClose,
		onFormChange,
		onSave,
		onDelete,
		onDuplicate,
		onRoutesChanged,
	} = props;

	const t = useTranslations("providers.modal");
	const tKind = useTranslations("providers.kind");
	const tCommon = useTranslations("common");
	const locale = useLocale();
	const routesState = useProviderRoutes(
		open ? editingProvider?.id ?? null : null,
		onRoutesChanged
	);
	const busy = isSaving || isDeleting || routesState.isDeleting;
	const deleteDisabled =
		busy || !routesState.ready || routesState.routes.length > 0;
	const deleteDisabledReason = routesState.error
		? t("relatedRoutes.loadFailed")
		: !routesState.ready
		? tCommon("loading")
		: routesState.routes.length > 0
		? t("routesBlocked", { count: routesState.routes.length })
		: isSaving
		? tCommon("saving")
		: isDeleting || routesState.isDeleting
		? tCommon("deleting")
		: undefined;

	const [activeTab, setActiveTab] = useState<"basic" | "endpoints" | "routes">(
		"basic"
	);
	const dialogRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	const tabsId = useId();
	const [endpointTab, setEndpointTab] = useState<UpstreamProtocol>("openai");
	const [showEndpointsJson, setShowEndpointsJson] = useState(false);
	const [showApiKey, setShowApiKey] = useState(false);
	const [apiKeyFocused, setApiKeyFocused] = useState(false);
	const previewApiKey =
		Boolean(editingProvider) && !showApiKey && !apiKeyFocused;
	const [apiKeyCopied, setApiKeyCopied] = useState(false);
	const mainTabs: Array<{
		key: "basic" | "endpoints" | "routes";
		label: string;
		Icon: typeof InformationCircleIcon;
	}> = [
		{ key: "basic", label: t("basicInfo"), Icon: InformationCircleIcon },
		{
			key: "endpoints",
			label: t("endpointSettings"),
			Icon: AdjustmentsHorizontalIcon,
		},
		...(editingProvider
			? [
					{
						key: "routes" as const,
						label: t("relatedRoutes.title"),
						Icon: ShareIcon,
					},
			  ]
			: []),
	];
	const kindChoices = useMemo(() => {
		return listProviderKindChoices()
			.map((choice) => ({
				...choice,
				label: pickProviderKindLabel(choice.labels, locale),
			}))
			.sort((a, b) => a.label.localeCompare(b.label, locale));
	}, [locale]);
	const selectedKind = kindChoices.find(
		(choice) => choice.kind === formData.kind
	);
	const showUnclassified =
		Boolean(editingProvider) && !String(editingProvider?.kind ?? "").trim();
	const catalogIntro = useMemo(() => {
		const preset = getStaticProviderPresetByKind(formData.kind);
		if (!preset) return "";
		return pickProviderCatalogText(providerPresetCatalogCopy(preset), locale);
	}, [formData.kind, locale]);

	useEffect(() => {
		setActiveTab("basic");
		setShowEndpointsJson(false);
		setShowApiKey(false);
		setApiKeyFocused(false);
		setApiKeyCopied(false);
	}, [open, editingProvider?.id, duplicateSourceId]);

	useEffect(() => {
		if (!open) return;
		const firstConfigured = PROTOCOL_TABS.find(({ key }) =>
			protocolFormIsConfigured(key, formData[key])
		);
		setEndpointTab(firstConfigured?.key ?? "openai");
		// 仅在打开不同供应商时选中已配置协议；输入过程中不重置 Tab。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, editingProvider?.id, duplicateSourceId]);

	useEffect(() => {
		if (!open) return;
		const previous =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		dialogRef.current?.focus();
		return () => {
			document.body.style.overflow = previousOverflow;
			previous?.focus();
		};
	}, [open]);

	useEffect(() => {
		// Shared confirmation dialogs remove their focused button when dismissed.
		if (open && !busy && document.activeElement === document.body) {
			dialogRef.current?.focus();
		}
	}, [open, busy]);

	if (!open) return null;

	const deleteButton = editingProvider ? (
		<button
			type="button"
			onClick={() => {
				if (!deleteDisabled) void onDelete(editingProvider.id);
			}}
			disabled={deleteDisabled}
			className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:pointer-events-none disabled:opacity-50"
		>
			<TrashIcon className="h-4 w-4" aria-hidden />
			{isDeleting ? tCommon("deleting") : t("deleteProvider")}
		</button>
	) : null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-2 sm:p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) {
					onClose();
				}
			}}
		>
			<div
				ref={dialogRef}
				tabIndex={-1}
				onKeyDown={(event) => {
					if (
						event.key === "Escape" &&
						!busy &&
						!document.querySelector('[role="alertdialog"]')
					) {
						event.stopPropagation();
						onClose();
					}
					if (
						event.key !== "Tab" ||
						document.querySelector('[role="alertdialog"]')
					)
						return;
					const focusable = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>(
							'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'
						)
					).filter((element) => element.getClientRects().length > 0);
					const first = focusable[0];
					const last = focusable[focusable.length - 1];
					if (
						event.shiftKey &&
						(document.activeElement === first ||
							document.activeElement === event.currentTarget)
					) {
						event.preventDefault();
						last?.focus();
					} else if (
						!event.shiftKey &&
						(document.activeElement === last ||
							document.activeElement === event.currentTarget)
					) {
						event.preventDefault();
						first?.focus();
					}
				}}
				className="flex h-[min(760px,90dvh)] max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-5 pt-6 sm:px-7">
					<div>
						<h2 id={titleId} className="text-lg font-semibold text-gray-900">
							{editingProvider ? t("editTitle") : t("newTitle")}
						</h2>
						<p className="mt-1.5 text-sm text-gray-500">
							{editingProvider ? t("editHint") : t("newHint")}
						</p>
						{!editingProvider && duplicateSourceId && (
							<p className="mt-1 text-xs text-gray-500">
								{t("prefilledFrom", { id: duplicateSourceId })}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={() => {
							if (!busy) onClose();
						}}
						className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						disabled={busy}
						aria-label={tCommon("close")}
					>
						<XMarkIcon className="h-5 w-5" aria-hidden />
					</button>
				</div>

				<div className="flex shrink-0 flex-wrap items-start justify-between gap-x-4 border-b border-gray-200 px-5 sm:px-7">
					<div
						role="tablist"
						aria-label={t("modalTabs")}
						className="flex gap-3 sm:gap-5"
					>
						{mainTabs.map(({ key, label, Icon }) => (
							<button
								key={key}
								type="button"
								role="tab"
								id={`${tabsId}-${key}`}
								aria-selected={activeTab === key}
								aria-controls={`${tabsId}-${key}-panel`}
								onClick={() => {
									setActiveTab(key);
									setShowEndpointsJson(false);
								}}
								onKeyDown={navigateTabs}
								tabIndex={activeTab === key ? 0 : -1}
								className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
									activeTab === key
										? "border-blue-600 text-blue-700"
										: "border-transparent text-gray-500 hover:text-gray-900"
								}`}
							>
								<Icon className="hidden h-4 w-4 sm:block" aria-hidden />
								{label}
								{key === "routes" && routesState.ready ? (
									<span
										className={`rounded-full px-2 py-0.5 text-xs ${
											activeTab === key
												? "bg-blue-50 text-blue-700"
												: "bg-gray-100 text-gray-600"
										}`}
									>
										{routesState.routes.length}
									</span>
								) : null}
							</button>
						))}
					</div>
					{activeTab === "endpoints" ? (
						<button
							type="button"
							onClick={() => setShowEndpointsJson((value) => !value)}
							aria-pressed={showEndpointsJson}
							className="mb-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<CodeBracketIcon className="h-4 w-4" aria-hidden />
							{t(
								showEndpointsJson ? "backToEndpointForm" : "viewEndpointsJson"
							)}
						</button>
					) : null}
				</div>
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-7">
					{saveError && (
						<div className="mb-4 shrink-0 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
							{saveError}
						</div>
					)}

					<div className="flex min-h-0 flex-1 flex-col">
						<section
							className="min-h-0 flex-1"
							hidden={activeTab !== "basic"}
							role="tabpanel"
							id={`${tabsId}-basic-panel`}
							aria-labelledby={`${tabsId}-basic`}
						>
							<div className="grid gap-8 md:h-full md:min-h-0 md:grid-cols-[1fr_0.9fr]">
								<div className="min-w-0 space-y-5 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:pr-1">
									<div>
										<label
											htmlFor={`${tabsId}-kind`}
											className="mb-1 block text-sm font-medium text-gray-700"
										>
											{editingProvider ? t("kind") : t("kindRequired")}
										</label>
										<div className="flex items-center gap-2">
											<select
												id={`${tabsId}-kind`}
												value={formData.kind}
												onChange={(e) =>
													onFormChange({ ...formData, kind: e.target.value })
												}
												className="h-10 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
												required={!editingProvider}
											>
												<option value="" disabled={!showUnclassified}>
													{showUnclassified
														? tKind("unclassified")
														: t("kindPlaceholder")}
												</option>
												<option value={CUSTOM_PROVIDER_KIND}>
													{tKind("custom")}
												</option>
												{kindChoices.map((choice) => (
													<option key={choice.kind} value={choice.kind}>
														{choice.label}
													</option>
												))}
											</select>
											{formData.kind === CUSTOM_PROVIDER_KIND ? (
												<VendorIcon
													vendor="other"
													iconKey="other"
													size="default"
													className="!h-10 !w-10 [&>span:first-child]:!h-6 [&>span:first-child]:!w-6"
												/>
											) : selectedKind ? (
												<VendorIcon
													vendor={selectedKind.vendorKey}
													iconKey={selectedKind.iconKey}
													size="default"
													className="!h-10 !w-10 [&>span:first-child]:!h-6 [&>span:first-child]:!w-6"
												/>
											) : null}
										</div>
										<p className="mt-1.5 text-xs text-gray-500">
											{t("kindHint")}
										</p>
									</div>
									<div>
										<label
											htmlFor={`${tabsId}-name`}
											className="mb-1 block text-sm font-medium text-gray-700"
										>
											{t("nameRequired")}
										</label>
										<input
											type="text"
											id={`${tabsId}-name`}
											value={formData.name}
											onChange={(e) =>
												onFormChange({ ...formData, name: e.target.value })
											}
											className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
											placeholder={t("namePlaceholder")}
											autoComplete="off"
											required
										/>
									</div>
									<div>
										<div className="mb-1 flex items-center justify-between gap-2">
											<label
												htmlFor={`${tabsId}-api-key`}
												className="block text-sm font-medium text-gray-700"
											>
												{editingProvider
													? t("apiKeyOptional")
													: t("apiKeyRequired")}
											</label>
											<ProviderCatalogOutboundLink
												links={
													resolveStoredProviderPresentation({
														kind: formData.kind,
														name: formData.name,
														endpoints: editingProvider?.endpoints,
													}).catalogLinks
												}
												className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
											/>
										</div>
										<div className="relative">
											<input
												id={`${tabsId}-api-key`}
												disabled={isApiKeyLoading}
												aria-busy={isApiKeyLoading}
												type={
													previewApiKey || (editingProvider && showApiKey)
														? "text"
														: "password"
												}
												value={
													previewApiKey
														? providerApiKeyPreview(formData.api_key)
														: formData.api_key
												}
												onFocus={() => setApiKeyFocused(true)}
												onBlur={() => setApiKeyFocused(false)}
												spellCheck={false}
												autoCapitalize="none"
												onChange={(e) =>
													onFormChange({ ...formData, api_key: e.target.value })
												}
												className={`${inputClass} font-mono ${
													editingProvider && formData.api_key ? "pr-16" : ""
												}`}
												placeholder={
													isApiKeyLoading
														? tCommon("loading")
														: editingProvider
														? t("apiKeyEditPlaceholder")
														: t("apiKeyPlaceholder")
												}
												autoComplete="new-password"
											/>
											{editingProvider && formData.api_key ? (
												<div className="absolute inset-y-0 right-1 flex items-center">
													<button
														type="button"
														onClick={() => setShowApiKey((current) => !current)}
														className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700"
														aria-pressed={showApiKey}
														aria-label={
															showApiKey ? tCommon("hide") : tCommon("show")
														}
														title={
															showApiKey ? tCommon("hide") : tCommon("show")
														}
													>
														{showApiKey ? (
															<EyeSlashIcon className="h-4 w-4" aria-hidden />
														) : (
															<EyeIcon className="h-4 w-4" aria-hidden />
														)}
													</button>
													<button
														type="button"
														onClick={() => {
															const value = formData.api_key.trim();
															if (!value || !navigator.clipboard?.writeText)
																return;
															void navigator.clipboard
																.writeText(value)
																.then(() => {
																	setApiKeyCopied(true);
																	window.setTimeout(
																		() => setApiKeyCopied(false),
																		2000
																	);
																});
														}}
														className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700"
														aria-label={
															apiKeyCopied ? tCommon("copied") : tCommon("copy")
														}
														title={
															apiKeyCopied ? tCommon("copied") : tCommon("copy")
														}
													>
														{apiKeyCopied ? (
															<CheckIcon
																className="h-4 w-4 text-emerald-600"
																aria-hidden
															/>
														) : (
															<ClipboardDocumentIcon
																className="h-4 w-4"
																aria-hidden
															/>
														)}
													</button>
												</div>
											) : null}
										</div>
										<p className="mt-1 text-xs text-gray-500">
											{editingProvider ? t("apiKeyEditHint") : t("apiKeyHint")}
										</p>
									</div>
								</div>
								<div className="flex min-w-0 flex-col gap-5 md:h-full md:min-h-0">
									{catalogIntro ? (
										<div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50/40 p-4 md:min-h-0 md:flex-1">
											<h3 className="shrink-0 text-xs font-medium text-gray-500">
												{t("catalogIntro")}
											</h3>
											<p
												tabIndex={0}
												className="mt-2 max-h-40 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-200 md:min-h-0 md:max-h-none md:flex-1"
											>
												{catalogIntro}
											</p>
										</div>
									) : null}
									<div className="shrink-0">
										<label
											htmlFor={`${tabsId}-note`}
											className="mb-2 block text-xs font-medium text-gray-700"
										>
											{t("note")}
										</label>
										<textarea
											id={`${tabsId}-note`}
											rows={4}
											value={formData.note}
											onChange={(e) =>
												onFormChange({ ...formData, note: e.target.value })
											}
											className="block h-32 max-h-32 w-full resize-none overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
											placeholder={t("notePlaceholder")}
											autoComplete="off"
										/>
									</div>
								</div>
							</div>
						</section>

						<section
							hidden={activeTab !== "endpoints"}
							role="tabpanel"
							id={`${tabsId}-endpoints-panel`}
							aria-labelledby={`${tabsId}-endpoints`}
						>
							{showEndpointsJson ? (
								<ProviderEndpointsJsonPreview form={formData} />
							) : (
								<div className="grid items-start gap-5 md:grid-cols-[160px_minmax(0,1fr)]">
									<div
										className="flex flex-wrap gap-1 rounded-xl bg-gray-50 p-2 md:flex-col"
										role="tablist"
										aria-label={t("endpointsTabsAria")}
									>
										{PROTOCOL_TABS.map(({ key, labelKey }) => {
											const selected = endpointTab === key;
											const configured = protocolFormIsConfigured(
												key,
												formData[key]
											);
											return (
												<button
													key={key}
													type="button"
													role="tab"
													id={`provider-endpoint-tab-${key}`}
													aria-selected={selected}
													aria-controls={`provider-endpoint-panel-${key}`}
													onClick={() => setEndpointTab(key)}
													onKeyDown={navigateTabs}
													tabIndex={selected ? 0 : -1}
													className={`inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
														selected
															? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
															: "text-gray-600 hover:bg-white/70 hover:text-gray-900"
													}`}
												>
													<span className="h-4 w-4 shrink-0">
														<ProviderProtocolIcon protocol={key} />
													</span>
													{t(labelKey)}
													{configured ? (
														<span
															className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
															title={t("configured")}
															aria-label={t("configured")}
														/>
													) : null}
												</button>
											);
										})}
									</div>
									<div
										key={endpointTab}
										className="min-w-0"
										role="tabpanel"
										id={`provider-endpoint-panel-${endpointTab}`}
										aria-labelledby={`provider-endpoint-tab-${endpointTab}`}
									>
										<ProtocolFields
											protocol={endpointTab}
											form={formData[endpointTab]}
											onChange={(next) =>
												onFormChange({ ...formData, [endpointTab]: next })
											}
										/>
									</div>
								</div>
							)}
						</section>
						{editingProvider ? (
							<section
								hidden={activeTab !== "routes"}
								role="tabpanel"
								id={`${tabsId}-routes-panel`}
								aria-labelledby={`${tabsId}-routes`}
							>
								<ProviderRelatedRoutes
									key={editingProvider.id}
									state={routesState}
									disabled={busy}
								/>
							</section>
						) : null}
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-4 sm:px-7">
					<div className="flex flex-wrap items-center gap-2">
						{editingProvider &&
							(deleteDisabledReason ? (
								<InfoHintPopover
									label={t("deleteProvider")}
									disabledTrigger={deleteButton}
									openOnHover
									openOnFocus
									portal
									align="start"
								>
									<p className="leading-5">{deleteDisabledReason}</p>
								</InfoHintPopover>
							) : (
								deleteButton
							))}
					</div>
					<div className="ml-auto flex gap-2">
						<button
							type="button"
							onClick={() => {
								if (!busy) onClose();
							}}
							className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
							disabled={busy}
						>
							{tCommon("cancel")}
						</button>
						{editingProvider && (
							<button
								type="button"
								onClick={() => onDuplicate(editingProvider)}
								disabled={busy}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon("duplicate")}
							</button>
						)}
						<button
							type="button"
							onClick={() => void onSave()}
							disabled={busy}
							className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving
								? tCommon("saving")
								: editingProvider
								? tCommon("save")
								: tCommon("create")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
