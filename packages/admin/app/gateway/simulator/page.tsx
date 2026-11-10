'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * Browser-side simulator: calls the Proxy directly (user-provided Base URL) with a real API key,
 * exercising auth, routing, billing, and request logs (unlike Playground upstream tests).
 */
import { PricingInfoHint } from '@/components/PricingInfoHint';
import { useTranslations } from 'next-intl';
import { SimulatorRequestPanel } from './components/simulator-request-panel';
import { SimulatorResponsePanel } from './components/simulator-response-panel';
import { SimulatorRoutingPanel } from './components/simulator-routing-panel';
import { SimulatorSetupPanel } from './components/simulator-setup-panel';
import { useSimulatorPageState } from './use-simulator-page-state';

export default function SimulatorPage() {
	const t = useTranslations('simulator');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const s = useSimulatorPageState();
	const llm =
		!s.isToolKind && !s.selectedModelIsImage && !s.selectedModelIsAudio && !s.selectedModelIsEmbedding;
	const llmFamily = llm
		? s.protocol === 'openai'
			? s.openaiLlmOperation === 'responses'
				? 'openai_responses'
				: 'openai_chat'
			: s.protocol === 'anthropic'
			? 'anthropic'
			: s.protocol === 'gemini'
			? 'gemini'
			: null
		: null;

	if (s.loadingCatalog) {
		return (
			<div className="flex h-full min-h-[240px] items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-gray-50 p-4 sm:p-6 lg:p-8 xl:h-full xl:overflow-hidden">
			<div className="mb-6 shrink-0">
				<AdminPageTitle>{t('title')}</AdminPageTitle>
				<p className="mt-1 max-w-3xl text-sm text-gray-500">
					{t('subtitle', { product: tBrand('product') })}
				</p>
			</div>

			<p className="mb-4 flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
				{t('usageNote')}
				<PricingInfoHint kind="simulator" align="start" />
			</p>

			{s.catalogError ? (
				<div className="mb-4 max-w-3xl rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
					{s.catalogError}
				</div>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<SimulatorSetupPanel
					disabled={s.sending}
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
				<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:items-stretch">
					<aside className="flex w-full min-w-0 shrink-0 flex-col xl:min-h-0 xl:w-72 2xl:w-80 xl:overflow-hidden">
						<SimulatorRoutingPanel
							disabled={s.sending}
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
							realtimeOperation={s.selectedRealtimeOperation}
							realtimeOperationOptions={s.realtimeOperationOptions}
							onRealtimeOperationChange={s.setDashScopeRealtimeOperation}
							selectedModelIsAudio={s.selectedModelIsAudio}
							modelRoutingString={s.modelRoutingString}
							matchingRoutes={s.matchingRoutesForDisplay}
							providerLabelFor={s.providerLabelFor}
						/>
					</aside>

					<section className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
						<div className="flex min-h-0 min-w-0 flex-col">
							<SimulatorRequestPanel
								llmFamily={llmFamily}
								modelHint={s.selectedModelId}
								wireSent={s.wireSent}
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
								sending={s.sending}
								canSend={s.canSend}
								sendBlockedHint={s.sendBlockedHint}
								onSend={() => void s.send()}
								onStop={() => s.stop()}
								showImageOperation={
									s.selectedModelIsImage &&
									!s.selectedModelIsAudio &&
									(s.protocol === 'openai' ||
										s.protocol === 'minimax' ||
										s.protocol === 'volcengine' ||
										s.protocol === 'gemini')
								}
								imageOperation={s.imageOperation}
								onImageOperationChange={s.setImageOperation}
								editFiles={s.editFiles}
								onEditFilesChange={s.setEditFiles}
								showAudioTranscriptions={
									s.selectedAudioOperation === 'transcriptions' &&
									(s.protocol === 'openai' ||
										s.protocol === 'dashscope' ||
										s.protocol === 'minimax' ||
										s.protocol === 'elevenlabs')
								}
								showAudioRealtimeMicrophone={s.selectedCanUseMicrophone}
								audioInputMode={s.audioInputMode}
								onAudioInputModeChange={s.setAudioInputMode}
								showAudioSpeech={
									s.selectedAudioOperation === 'speech' &&
									(s.protocol === 'openai' ||
										s.protocol === 'dashscope' ||
										s.protocol === 'minimax' ||
										s.protocol === 'elevenlabs')
								}
								showAudioRealtime={
									s.selectedAudioOperation != null &&
									((s.protocol === 'dashscope' &&
										(s.selectedRealtimeOperation?.includes('.realtime.') ?? false)) ||
										s.selectedElevenLabsRealtimeOperation != null)
								}
								audioFile={s.audioFile}
								onAudioFileChange={s.setAudioFile}
							/>
						</div>
						<div className="flex min-h-0 min-w-0 flex-col">
							<SimulatorResponsePanel
								llm={llm}
								responsePreview={s.responsePreview}
								sending={s.sending}
								interrupted={s.interrupted}
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
