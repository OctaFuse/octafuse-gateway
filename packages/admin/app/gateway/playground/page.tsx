'use client';

/**
 * Playground：选定单条 model_route，编辑 JSON 请求体，直连上游验证连通性（不计费、不入库）。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { PlaygroundRequestPanel } from './components/playground-request-panel';
import { PlaygroundResponsePanel } from './components/playground-response-panel';
import { PlaygroundSetupPanel } from './components/playground-setup-panel';
import { PlaygroundToolsSetup, PlaygroundToolsWorkspace, usePlaygroundToolsState } from './playground-tools-panel';
import { usePlaygroundPageState } from './use-playground-page-state';

function PlaygroundPageInner() {
	const t = useTranslations('playground');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const s = usePlaygroundPageState();
	const tools = usePlaygroundToolsState(s.initialToolId, s.initialProvider);

	if (s.loadingRoutes && s.playgroundMode === 'routes') {
		return (
			<div className="flex h-full min-h-[240px] items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-col overflow-x-hidden bg-gray-100/90 p-4 sm:p-6 lg:p-8 xl:h-dvh xl:overflow-hidden">
			<div className="mb-4 shrink-0 sm:mb-5">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 max-w-3xl text-sm text-gray-500">
					{s.playgroundMode === 'tools'
						? t('toolsSubtitle', { product: tBrand('product') })
						: t('subtitle', { product: tBrand('product') })}
					<span className="text-gray-400"> · </span>
					{t('usageNote')}
				</p>
				<div
					className="mt-4 inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
					role="group"
					aria-label={t('mode')}
				>
					{(
						[
							{ id: 'routes' as const, label: t('modeRoutes') },
							{ id: 'tools' as const, label: t('modeTools') },
						] as const
					).map((opt) => {
						const active = s.playgroundMode === opt.id;
						return (
							<button
								key={opt.id}
								type="button"
								onClick={() => s.setPlaygroundMode(opt.id)}
								className={
									active
										? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
										: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
								}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			{s.playgroundMode === 'routes' && s.loadError ? (
				<div className="mb-4 max-w-3xl rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">
					{s.loadError}
				</div>
			) : null}

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
				<div className="flex min-h-0 min-w-0 flex-1 flex-col xl:flex-row xl:items-stretch">
					<aside className="flex w-full shrink-0 flex-col border-b border-gray-200/80 bg-slate-50/80 p-4 xl:min-h-0 xl:w-[380px] xl:overflow-hidden xl:border-b-0 xl:border-r">
						{s.playgroundMode === 'tools' ? (
							<PlaygroundToolsSetup state={tools} />
						) : (
							<PlaygroundSetupPanel
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
								routesInKindTotal={s.routesInKind.length}
								filteredRoutes={s.filteredRoutes}
								selectedId={s.selectedId}
								onSelectRoute={s.selectRoute}
								selected={s.selected}
							/>
						)}
					</aside>

					<section className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-slate-100/70 p-4 sm:p-5 xl:overflow-hidden">
						{s.playgroundMode === 'tools' ? (
							<PlaygroundToolsWorkspace state={tools} />
						) : (
							<div className="flex min-h-0 flex-1 flex-col gap-4">
								<PlaygroundRequestPanel
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
									selected={s.selected}
									selectedUsesDashScopeRealtime={s.selectedUsesDashScopeRealtime}
									imageSendBlocked={s.imageSendBlocked}
									selectedImageUsesDashScope={s.selectedImageUsesDashScope}
									audioSendBlocked={s.audioSendBlocked}
									selectedIsImage={s.selectedIsImage}
									selectedIsAudio={s.selectedIsAudio}
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
