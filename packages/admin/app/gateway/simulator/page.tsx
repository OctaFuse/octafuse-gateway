"use client";

/**
 * Browser-side simulator: calls the Proxy directly (user-provided Base URL) with a real API key,
 * exercising auth, routing, billing, and request logs (unlike Playground upstream tests).
 */
import { useTranslations } from "next-intl";
import { SimulatorRequestPanel } from "./components/simulator-request-panel";
import { SimulatorResponsePanel } from "./components/simulator-response-panel";
import { SimulatorRoutingPanel } from "./components/simulator-routing-panel";
import { SimulatorSetupPanel } from "./components/simulator-setup-panel";
import { useSimulatorPageState } from "./use-simulator-page-state";

export default function SimulatorPage() {
	const t = useTranslations("simulator");
	const tBrand = useTranslations("brand");
	const tCommon = useTranslations("common");
	const s = useSimulatorPageState();

	if (s.loadingCatalog) {
		return (
			<div className="flex h-full min-h-[240px] items-center justify-center">
				<div className="text-gray-600">{tCommon("loading")}</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-gray-100/90 p-4 sm:p-6 lg:p-8 xl:h-dvh xl:overflow-hidden">
			<div className="mb-4 shrink-0 sm:mb-5">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
					{t("title")}
				</h1>
				<p className="mt-1 max-w-3xl text-sm text-gray-500">
					{t("subtitle", { product: tBrand("product") })}
					<span className="text-gray-400"> · </span>
					{t("usageNote")}
				</p>
			</div>

			{s.catalogError ? (
				<div className="mb-4 max-w-3xl rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
					{s.catalogError}
				</div>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
				<SimulatorSetupPanel
					proxyBaseUrl={s.proxyBaseUrl}
					onProxyBaseUrlChange={s.setProxyBaseUrl}
					filterKeyEmail={s.filterKeyEmail}
					onFilterKeyEmailChange={s.setFilterKeyEmail}
					loadingKeys={s.loadingKeys}
					keysError={s.keysError}
					keys={s.keys}
					keysTotal={s.keysTotal}
					onRefreshKeys={() => void s.loadKeys()}
					selectedKeyId={s.selectedKeyId}
					onSelectedKeyIdChange={s.setSelectedKeyId}
					revealedSk={s.revealedSk}
					revealLoading={s.revealLoading}
					revealError={s.revealError}
				/>
				<div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row xl:items-stretch">
					<aside className="flex w-full shrink-0 flex-col border-b border-gray-200/80 bg-slate-50/80 p-4 xl:min-h-0 xl:w-[380px] xl:overflow-hidden xl:border-b-0 xl:border-r">
						<SimulatorRoutingPanel
							filterKind={s.filterKind}
							protocol={s.protocol}
							onFilterKindChange={s.setFilterKind}
							kindCounts={s.kindCounts}
							isToolKind={s.isToolKind}
							gatewayTools={s.gatewayTools}
							selectedToolId={s.selectedToolId}
							onSelectTool={s.selectTool}
							filterModel={s.filterModel}
							onFilterModelChange={s.setFilterModel}
							filteredModels={s.filteredModels}
							modelsInKindTotal={s.modelsInKind.length}
							selectedModelId={s.selectedModelId}
							onSelectModel={s.selectModel}
							routeGroup={s.routeGroup}
							onRouteGroupChange={s.setRouteGroup}
							routeGroupsForModel={s.routeGroupsForModel}
							realtimeOperation={s.selectedDashScopeRealtimeOperation}
							realtimeOperationOptions={s.realtimeOperationOptions}
							onRealtimeOperationChange={s.setDashScopeRealtimeOperation}
							selectedModelIsAudio={s.selectedModelIsAudio}
							modelRoutingString={s.modelRoutingString}
							matchingRoutes={s.matchingRoutes}
						/>
					</aside>

					<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden bg-slate-100/70 p-4 sm:p-5">
						<div className="min-h-0 flex-[3] overflow-y-auto">
							<SimulatorRequestPanel
								protocol={s.protocol}
								onProtocolChange={s.requestProtocolChange}
								supportedSurfaces={s.supportedSurfaces}
								hasSelectedModel={!s.isToolKind && Boolean(s.selectedModelId)}
								hideProtocolControls={s.isToolKind}
								geminiAction={s.geminiAction}
								onGeminiActionChange={s.setGeminiAction}
								openaiLlmOperation={s.openaiLlmOperation}
								onOpenaiLlmOperationChange={s.requestOpenaiLlmOperationChange}
								bodyText={s.bodyText}
								onBodyTextChange={s.setBodyText}
								bodyDirty={s.bodyDirty}
								onApplyTemplate={s.applyCurrentTemplate}
								infoHint={s.infoHint}
								bodyError={s.bodyError}
								displayWire={s.displayWire}
								wireOpen={s.wireOpen}
								onWireOpenChange={s.setWireOpen}
								sending={s.sending}
								canSend={s.canSend}
								sendBlockedHint={s.sendBlockedHint}
								onSend={() => void s.send()}
								onStop={() => s.stop()}
								showImageOperation={
									s.selectedModelIsImage &&
									!s.selectedModelIsAudio &&
									s.protocol === "openai"
								}
								imageOperation={s.imageOperation}
								onImageOperationChange={s.setImageOperation}
								editFiles={s.editFiles}
								onEditFilesChange={s.setEditFiles}
								showAudioTranscriptions={
									s.selectedAudioOperation === "transcriptions" &&
									(s.protocol === "openai" || s.protocol === "dashscope")
								}
								showAudioRealtimeMicrophone={s.selectedCanUseMicrophone}
								audioInputMode={s.audioInputMode}
								onAudioInputModeChange={s.setAudioInputMode}
								showAudioSpeech={
									s.selectedAudioOperation === "speech" &&
									(s.protocol === "openai" || s.protocol === "dashscope")
								}
								showAudioRealtime={
									s.protocol === "dashscope" && s.selectedAudioOperation != null
								}
								audioFile={s.audioFile}
								onAudioFileChange={s.setAudioFile}
							/>
						</div>
						<div className="min-h-0 flex-[2] overflow-y-auto">
							<SimulatorResponsePanel
								responseMeta={s.responseMeta}
								responseText={s.responseText}
								usageHint={s.usageHint}
								imagePreviews={s.imagePreviews}
								audioPreviewUrl={s.audioPreviewUrl}
								responseTab={s.responseTab}
								onResponseTabChange={s.setResponseTab}
								mergedReasoningDisplay={s.mergedReasoningDisplay}
								mergedBodyDisplay={s.mergedBodyDisplay}
								streamEndRef={s.streamEndRef}
								mergedStreamEndRef={s.mergedStreamEndRef}
								selectedKeyId={s.selectedKeyId}
								selectedModelId={s.selectedModelId}
								routeGroup={s.routeGroup}
								protocol={s.protocol}
								isToolKind={s.isToolKind}
								selectedToolId={s.selectedToolId}
							/>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
