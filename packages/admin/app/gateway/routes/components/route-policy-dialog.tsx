'use client';

import { useAdminDialog } from '@/components/use-admin-dialog';
import { ArrowsRightLeftIcon, XMarkIcon } from '@heroicons/react/24/outline';

import { ROUTE_STRATEGY_NAMES } from '@octafuse/core/db/model-route-policy';
import { useTranslations } from 'next-intl';
import {
	CAPABILITIES_BY_PROTOCOL,
	isPromptCacheSensitiveCapability,
} from '../route-utils';
import type { RoutePolicyDialogState, RoutePolicyFormState } from '../types';
import { RouteStrategyPicker } from './route-strategy-picker';

type Props = {
	dialog: RoutePolicyDialogState;
	form: RoutePolicyFormState;
	error: string;
	saving: boolean;
	onClose: () => void;
	onFormChange: (form: RoutePolicyFormState) => void;
	onSave: () => void;
};

const STRATEGY_OPTIONS = ['', ...ROUTE_STRATEGY_NAMES] as const;

export function RoutePolicyDialog(props: Props) {
	const { dialog, form, error, saving, onClose, onFormChange, onSave } = props;
	const t = useTranslations('routes.strategy');
	const tCommon = useTranslations('common');
	const dialogRef = useAdminDialog(true, saving, onClose);
	const isTierMode = dialog.priority !== undefined;
	const capabilities = dialog.poolId || isTierMode ? [] : CAPABILITIES_BY_PROTOCOL[dialog.protocol] ?? [];
	const tierInheritStrategy = form.protocolStrategy || dialog.inheritedStrategy;

	const strategyLabel = (value: string) => {
		if (!value) {
			const inherited =
				isTierMode
					? tierInheritStrategy
					: dialog.inheritedStrategy;
			return `${t('inherit')} → ${inherited}`;
		}
		if (value === 'hash_affinity') return t('display.hash_affinity');
		if (value === 'weighted_random') return t('display.weighted_random');
		if (value === 'weight_priority') return t('display.weight_priority');
		if (value === 'weighted_round_robin') return t('display.weighted_round_robin');
		return value;
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/40 p-3 sm:p-6"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !saving) onClose();
			}}
		>
			<div
				className="route-design-dialog flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-panel outline-none ring-1 ring-black/5"
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="route-policy-dialog-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
					<div>
						<h2 id="route-policy-dialog-title" className="flex items-center gap-2 text-base font-medium text-gray-900">
                                <span className="route-dialog-symbol" aria-hidden><ArrowsRightLeftIcon className="h-4 w-4" /></span>
							{isTierMode ? t('tierLevel') : t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">{dialog.requestOperation ?? dialog.group}</span>
							{isTierMode ? (
								<>
									{' '}
									· <span className="font-medium text-gray-700">P{dialog.priority}</span>
								</>
							) : null}
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<XMarkIcon className="h-4 w-4" aria-hidden />
					</button>
				</div>
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
					{error && (
						<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{error}
						</div>
					)}
					{!dialog.poolId && isTierMode ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
							{t('tierRequiresPool')}
						</div>
					) : null}
					{capabilities.length > 0 ? (
						<div>
							<div className="mb-2 text-sm font-medium text-gray-700">
								{t('capabilityLevel')}
							</div>
							<p className="mb-3 text-xs leading-relaxed text-gray-500">
								{t('capabilityHint')}
							</p>
							<div className="space-y-3">
								{capabilities.map((cap) => (
									<div key={cap}>
										<label className="mb-1 block font-mono text-xs font-medium text-gray-600">
											{cap}
										</label>
										<select
											value={form.capabilityStrategies[cap] ?? ''}
											onChange={(e) =>
												onFormChange({
													...form,
													capabilityStrategies: {
														...form.capabilityStrategies,
														[cap]: e.target.value,
													},
												})
											}
											className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500/30"
										>
											{STRATEGY_OPTIONS.map((opt) => (
												<option key={opt || 'inherit'} value={opt}>
													{strategyLabel(opt)}
												</option>
											))}
										</select>
										<p className="mt-1 text-xs leading-relaxed text-gray-500">
											{isPromptCacheSensitiveCapability(cap)
												? t('hintCache')
												: t('hintNoCache')}
										</p>
									</div>
								))}
							</div>
						</div>
					) : null}

					{isTierMode ? (
						<div>
							<div className="mb-1">
								<p className="mt-0.5 text-xs text-gray-500">{t('tierLevelHint')}</p>
							</div>
							<RouteStrategyPicker compact
								value={form.tierStrategy}
								onChange={(next) => onFormChange({ ...form, tierStrategy: next })}
								allowInherit
								inheritedStrategy={tierInheritStrategy}
								disabled={saving || !dialog.poolId}
								className="mt-3"
							/>
						</div>
					) : (
						<div>
							<div className="mb-1">
								<h3 className="text-sm font-medium text-gray-900">{t('guideTitle')}</h3>
								<p className="mt-0.5 text-xs text-gray-500">{t('guideHint')}</p>
							</div>
							<RouteStrategyPicker compact
								value={form.protocolStrategy}
								onChange={(next) => onFormChange({ ...form, protocolStrategy: next })}
								allowInherit
								inheritedStrategy={dialog.inheritedStrategy}
								disabled={saving}
								className="mt-3"
							/>
						</div>
					)}
					<div
						role="note"
						className="rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3"
					>
						<p className="text-sm font-medium text-sky-900">{t('cacheHitGuideTitle')}</p>
						<p className="mt-1 text-xs leading-relaxed text-sky-800">
							{t('cacheHitGuideBody')}
						</p>
					</div>
				</div>
				<div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-6 py-3.5">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={saving || (isTierMode && !dialog.poolId)}
						className="rounded-md admin-primary px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{saving ? tCommon('savingDots') : tCommon('save')}
					</button>
				</div>
			</div>
		</div>
	);
}
