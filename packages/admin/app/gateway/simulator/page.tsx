'use client';

/**
 * Browser-side simulator: calls the Proxy directly (user-provided Base URL) with a real API key,
 * exercising auth, routing, billing, and request logs (unlike Playground upstream tests).
 */
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

	if (s.loadingCatalog) {
		return (
			<div className="flex items-center justify-center h-full min-h-[240px]">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 sm:mb-6">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500 max-w-3xl">
					{t('subtitle', { product: tBrand('product') })}
					<span className="text-gray-400"> · </span>
					{t('usageNote')}
				</p>
			</div>

			{s.catalogError ? (
				<div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm max-w-3xl">
					{s.catalogError}
				</div>
			) : null}

			<div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
				<div className="flex min-w-0 flex-col xl:flex-row xl:items-stretch">
					<aside className="w-full shrink-0 border-b border-gray-200/80 bg-slate-50/80 p-4 xl:w-[380px] xl:border-b-0 xl:border-r xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
						<div className="space-y-4">
							<SimulatorSetupPanel
								proxyBaseUrl={s.proxyBaseUrl}
								onProxyBaseUrlChange={s.setProxyBaseUrl}
								protocol={s.protocol}
								onProtocolChange={s.requestProtocolChange}
								lockOpenaiForImage={s.selectedModelIsImage}
								geminiAction={s.geminiAction}
								onGeminiActionChange={s.setGeminiAction}
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
							<SimulatorRoutingPanel
								filterModel={s.filterModel}
								onFilterModelChange={s.setFilterModel}
								filteredModels={s.filteredModels}
								modelsTotal={s.models.length}
								modelIdsWithActiveRouter={s.modelIdsWithActiveRouter}
								selectedModelId={s.selectedModelId}
								onSelectModel={s.selectModel}
								routeGroup={s.routeGroup}
								onRouteGroupChange={s.setRouteGroup}
								routeGroupsForModel={s.routeGroupsForModel}
								selectedModel={s.selectedModel}
								selectedModelIsImage={s.selectedModelIsImage}
								modelRoutingString={s.modelRoutingString}
								matchingRoutes={s.matchingRoutes}
							/>
						</div>
					</aside>

					<section className="min-w-0 flex-1 bg-slate-100/70 p-4 sm:p-5 space-y-4">
						<SimulatorRequestPanel
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
						/>
						<SimulatorResponsePanel
							responseMeta={s.responseMeta}
							responseText={s.responseText}
							usageHint={s.usageHint}
							imagePreviews={s.imagePreviews}
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
						/>
					</section>
				</div>
			</div>
		</div>
	);
}
