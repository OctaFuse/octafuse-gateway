'use client';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * Playground：选定单条 model_route，编辑 JSON 请求体，直连上游验证连通性（不计费、不入库）。
 */
import { PricingInfoHint } from '@/components/PricingInfoHint';
import { BeakerIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline';
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { PlaygroundRequestPanel } from './components/playground-request-panel';
import { PlaygroundResponsePanel } from './components/playground-response-panel';
import { PlaygroundSetupPanel } from './components/playground-setup-panel';
import {
	PlaygroundToolsSetup,
	PlaygroundToolsWorkspace,
	usePlaygroundToolsState,
} from './playground-tools-panel';
import { usePlaygroundPageState } from './use-playground-page-state';

function PlaygroundPageInner() {
	const t = useTranslations('playground');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const s = usePlaygroundPageState();
	const tools = usePlaygroundToolsState(s.initialToolId, s.initialProvider);
	const llm = s.selected
		? !s.selectedIsImage && !s.selectedIsAudio && !s.selectedIsEmbedding
		: s.filterKind === 'llm';

	if (s.loadingRoutes && s.playgroundMode === 'routes') {
		return (
			<div className="flex h-full min-h-[240px] items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="admin-content-workspace content-tone-inference flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-gray-50 p-4 sm:p-6 lg:p-8 xl:h-full xl:overflow-hidden">
			<div className="mb-6 flex shrink-0 flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<AdminPageTitle>{t('title')}</AdminPageTitle>
					<p className="mt-1 max-w-3xl text-sm text-gray-500">
						{s.playgroundMode === 'tools'
							? t('toolsSubtitle', { product: tBrand('product') })
							: t('subtitle', { product: tBrand('product') })}
					</p>
				</div>
				<div className="inline-flex shrink-0 rounded-lg bg-gray-100 p-1" role="group" aria-label={t('mode')}>
					{(
						[
							{ id: 'routes' as const, label: t('modeRoutes'), icon: BeakerIcon },
							{ id: 'tools' as const, label: t('modeTools'), icon: WrenchScrewdriverIcon },
						] as const
					).map((opt) => {
						const active = s.playgroundMode === opt.id;
						return (
							<button
								key={opt.id}
								type="button"
								disabled={s.sending || tools.sending}
								onClick={() => s.setPlaygroundMode(opt.id)}
								aria-pressed={active}
								className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${
									active ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-950'
								}`}
							>
								<opt.icon className="h-4 w-4" aria-hidden />
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>
			<p className="mb-4 flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
				{t('usageNote')}
				<PricingInfoHint kind="playground" align="start" />
			</p>

			{s.playgroundMode === 'routes' && s.loadError ? (
				<div className="mb-4 max-w-3xl rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
					{s.loadError}
				</div>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:flex-row xl:items-stretch">
					<aside className="flex w-full min-w-0 shrink-0 flex-col xl:min-h-0 xl:w-72 2xl:w-80 xl:overflow-hidden">
						{s.playgroundMode === 'tools' ? (
							<PlaygroundToolsSetup state={tools} />
						) : (
							<PlaygroundSetupPanel
								disabled={s.sending}
								filterKind={s.filterKind}
								onFilterKindChange={s.onFilterKindChange}
								kindCounts={s.kindCounts}
								routeSearch={s.routeSearch}
								onRouteSearchChange={s.setRouteSearch}
								filterModel={s.filterModel}
								onFilterModelChange={s.setFilterModel}
								filterProvider={s.filterProvider}
								onFilterProviderChange={s.setFilterProvider}
								modelOptions={s.modelOptions}
								providerOptions={s.providerOptions}
								providerLabelFor={s.providerLabelFor}
								routesInKindTotal={s.routesInKind.length}
								filteredRoutes={s.filteredRoutes}
								selectedId={s.selectedId}
								onSelectRoute={s.selectRoute}
								selected={s.selected}
							/>
						)}
					</aside>

					<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 xl:overflow-hidden">
						{s.playgroundMode === 'tools' ? (
							<PlaygroundToolsWorkspace state={tools} />
						) : (
							<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
								<PlaygroundRequestPanel
									llm={llm}
									onApplyLlmBody={s.applyLlmBody}
									onResetTemplate={s.applyCurrentTemplate}
									bodyText={s.bodyText}
									onBodyTextChange={s.setBodyText}
									bodyDirtyHint={s.bodyDirtyHint}
									onApplyLlmSample={s.applyLlmSample}
									bodyError={s.bodyError}
									sending={s.sending}
									canSend={s.canSend}
									sendBlockedHint={s.sendBlockedHint}
									onSend={() => void s.send()}
									onStop={s.stop}
									requestTargetUrl={s.requestTargetUrl}
									requestTargetMissing={s.requestTargetMissing}
									selected={s.selected}
									selectedUsesDashScopeRealtime={s.selectedUsesDashScopeRealtime}
									selectedUsesElevenLabsRealtime={s.selectedUsesElevenLabsRealtime}
									selectedUsesRealtime={s.selectedUsesRealtime}
									imageSendBlocked={s.imageSendBlocked}
									selectedImageUsesDashScope={s.selectedImageUsesDashScope}
									audioSendBlocked={s.audioSendBlocked}
									selectedIsImage={s.selectedIsImage}
									selectedIsAudio={s.selectedIsAudio}
									selectedIsEmbedding={s.selectedIsEmbedding}
									selectedIsAudioTranscription={s.selectedIsAudioTranscription}
									selectedAudioUsesDashScope={s.selectedAudioUsesDashScope}
									selectedCanUseMicrophone={s.selectedCanUseMicrophone}
									selectedNeedsAudioFile={s.selectedNeedsAudioFile}
									imageOperation={s.imageOperation}
									onImageOperationChange={s.onImageOperationChange}
									editFiles={s.editFiles}
									onEditFilesChange={s.setEditFiles}
									audioFile={s.audioFile}
									onAudioFileChange={s.setAudioFile}
									audioInputMode={s.audioInputMode}
									onAudioInputModeChange={s.setAudioInputMode}
									geminiAction={s.geminiAction}
									onGeminiActionChange={s.setGeminiAction}
									lastSentWireBody={s.lastSentWireBody}
									lastSentWireHeaders={s.lastSentWireHeaders}
								/>
								<PlaygroundResponsePanel
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
									observationTags={s.observationTags}
									mergedReasoningDisplay={s.mergedReasoningDisplay}
									mergedBodyDisplay={s.mergedBodyDisplay}
									streamEndRef={s.streamEndRef}
									mergedStreamEndRef={s.mergedStreamEndRef}
								/>
							</div>
						)}
					</section>
				</div>
			</div>
		</div>
	);
}

function PlaygroundPageFallback() {
	const tCommon = useTranslations('common');
	return (
		<div className="flex h-full min-h-[240px] items-center justify-center">
			<div className="text-gray-600">{tCommon('loading')}</div>
		</div>
	);
}

export default function PlaygroundPage() {
	return (
		<Suspense fallback={<PlaygroundPageFallback />}>
			<PlaygroundPageInner />
		</Suspense>
	);
}
