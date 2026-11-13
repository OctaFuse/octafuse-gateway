'use client';

/**
 * 维护模式：开启后 Proxy 对推理请求返回友好的 503，可选同时冻结 Admin 写接口。
 * 数据迁移的"核心切换"依赖它冻结写入，也可单独用于任何维护窗口。
 * 作为配置中的独立标签加载；自动刷新默认关闭，隐藏时暂停，保留当前表单草稿。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { customMaintenanceMinutes } from '../maintenance/maintenance-input';
import { ClockIcon, PauseCircleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { announceMaintenanceChange } from '@/components/layout/MaintenanceBanner';
import { AutoRefreshControl } from '@/components/AutoRefreshControl';
import { maintenanceRefreshPreference } from '@/lib/auto-refresh-preference';
import { useAutoRefresh } from '@/lib/use-auto-refresh';
import type { MaintenanceStatus } from '@/lib/services/admin/maintenance-service';

const DURATION_PRESETS = [5, 15, 30, 60] as const;
const EXTEND_STEPS = [15, 30, 60] as const;
const MESSAGE_TOKEN = '{minutes}';

type Preset = 'none' | 'custom' | (typeof DURATION_PRESETS)[number];

const inputClass =
	'w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700';
const secondaryButtonClass =
	'rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

export function MaintenanceSettings({ visible }: { visible: boolean }) {
	const t = useTranslations('maintenance');
	const tCommon = useTranslations('common');
	const ui = useTranslations('remainingUi');
	const generation = useRef(0);
	const savingRef = useRef(false);
	const { notify, confirm } = useFeedback();
	const { formatDateTime } = useGatewayDateTime();

	const [status, setStatus] = useState<MaintenanceStatus | null>(null);
	const [loadError, setLoadError] = useState('');
	const [busy, setBusy] = useState(false);

	const [preset, setPreset] = useState<Preset>(15);
	const [customMinutes, setCustomMinutes] = useState('20');
	const [message, setMessage] = useState('');
	const [messageZh, setMessageZh] = useState('');
	const [messageEn, setMessageEn] = useState('');
	const [blockAdmin, setBlockAdmin] = useState(true);

	const load = useCallback(async () => {
		if (savingRef.current) return false;
		const request = ++generation.current;
		try {
			const response = await fetch('/api/admin/maintenance', { cache: 'no-store' });
			const data = await readApiJson<MaintenanceStatus>(response);
			if (request !== generation.current) return false;
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setStatus(data.data);
			setLoadError('');
			return true;
		} catch (cause) {
			if (request !== generation.current) return false;
			setLoadError(cause instanceof Error ? cause.message : t('loadFailed'));
			return false;
		}
	}, [t, tCommon]);

	const invalidateLoads = useCallback(() => {
		++generation.current;
	}, []);
	useEffect(() => {
		if (!visible) return;
		void load();
		return () => {
			invalidateLoads();
		};
	}, [load, invalidateLoads, visible]);

	const intervalMs = useSyncExternalStore(maintenanceRefreshPreference.subscribe, maintenanceRefreshPreference.read, () => 'off' as const);
	const refreshState = useAutoRefresh({ intervalMs, enabled: visible && !busy, refresh: load });

	const save = async (body: Record<string, unknown>, successKey: 'enabled' | 'extended' | 'disabled') => {
		if (savingRef.current) return;
		savingRef.current = true;
		++generation.current;
		setBusy(true);
		try {
			const response = await fetch('/api/admin/maintenance', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await readApiJson<MaintenanceStatus>(response);
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setStatus(data.data);
			setLoadError('');
			announceMaintenanceChange();
			notify(
				'success',
				t(`toast.${successKey}`),
				t('propagation', { seconds: data.data.propagation_seconds })
			);
		} catch (cause) {
			notify('error', cause instanceof Error ? cause.message : tCommon('requestFailed'));
		} finally {
			savingRef.current = false;
			setBusy(false);
		}
	};

	const durationMinutes = (): number | null => {
		if (preset === 'none') return null;
		if (preset === 'custom') {
			return customMaintenanceMinutes(customMinutes) ?? Number.NaN;
		}
		return preset;
	};

	const customInvalid = preset === 'custom' && Number.isNaN(durationMinutes());

	const handleEnable = async () => {
		const minutes = durationMinutes();
		if (minutes !== null && Number.isNaN(minutes)) return;
		const ok = await confirm({
			title: t('confirm.enableTitle'),
			message: t('confirm.enableMessage'),
			confirmLabel: t('confirm.enableConfirm'),
			danger: true,
		});
		if (!ok) return;
		const messages: Record<string, string> = {};
		if (messageZh.trim()) messages.zh = messageZh.trim();
		if (messageEn.trim()) messages.en = messageEn.trim();
		await save(
			{
				enabled: true,
				message: message.trim(),
				messages,
				...(minutes !== null ? { duration_minutes: minutes } : {}),
				block_admin_writes: blockAdmin,
			},
			'enabled'
		);
	};

	const handleExtend = async (step: number) => {
		if (!status?.config.enabled) return;
		const { config } = status;
		await save(
			{
				enabled: true,
				message: config.message,
				messages: config.messages,
				duration_minutes: (status.remaining_minutes ?? 0) + step,
				block_admin_writes: config.block_admin_writes,
			},
			'extended'
		);
	};

	const handleDisable = async () => {
		const ok = await confirm({
			title: t('confirm.disableTitle'),
			message: t('confirm.disableMessage'),
			confirmLabel: t('confirm.disableConfirm'),
		});
		if (!ok) return;
		await save({ enabled: false }, 'disabled');
	};

	if (!status && !loadError) {
		return (
			<div className="flex min-h-48 items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	if (!status) {
		return (
			<div className="min-w-0">
				<div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
					<p className="font-medium text-red-800">{t('loadFailed')}</p>
					<p className="mt-1 text-sm text-red-700">{loadError}</p>
					<button
						type="button"
						onClick={() => void load()}
						className="mt-4 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800"
					>
						{tCommon('retry')}
					</button>
				</div>
			</div>
		);
	}

	const { config } = status;
	const active = config.enabled;
	const expectedEnd = config.expected_end_at;
	const customMessages = Object.entries(config.messages);
	const hasCustomMessage = Boolean(config.message) || customMessages.length > 0;

	return (
		<div className="w-full min-w-0 space-y-5">
			{loadError && (
				<div className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{loadError}</div>
			)}

			<section id="maintenance-status" aria-labelledby="maintenance-status-title"
				className="admin-content-panel rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-3">
						<span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${active ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
							{active ? <PauseCircleIcon className="h-5 w-5" /> : <ShieldCheckIcon className="h-5 w-5" />}
						</span>
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<h2 id="maintenance-status-title" className="text-sm font-medium text-gray-900">{t('statusCard.title')}</h2>
								<span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${active ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
									<span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
									{active ? t('state.on') : t('state.off')}
								</span>
							</div>
							<p className="mt-1 text-sm leading-relaxed text-gray-500">{active ? t('onHint') : t('offHint')}</p>
						</div>
					</div>
					<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
						<AutoRefreshControl {...refreshState} intervalMs={intervalMs} onIntervalChange={maintenanceRefreshPreference.write}
							refresh={refreshState.refreshNow} label={t('refreshLabel')} refreshLabel={t('refreshNow')} disabled={busy || !visible} />
					{active && (
						<button type="button" disabled={busy} onClick={() => void handleDisable()}
							className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40">
							{busy ? tCommon('saving') : t('actions.disable')}
						</button>
					)}
					</div>
				</div>
				{active && (
					<>
						<dl className="mt-5 grid gap-4 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
							<div>
								<dt className="flex items-center gap-1.5 text-xs text-gray-500"><ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />{t('expectedEnd')}</dt>
								<dd className="mt-1 text-gray-900">{expectedEnd ? formatDateTime(expectedEnd) : t('noEta')}</dd>
								{expectedEnd && <dd className={`mt-1 text-xs ${status.remaining_minutes === null ? 'text-amber-700' : 'text-gray-500'}`}>
									{status.remaining_minutes !== null ? t('remaining', { minutes: status.remaining_minutes }) : t('overdue')}
								</dd>}
							</div>
							<div>
								<dt className="text-xs text-gray-500">{t('adminWrites.label')}</dt>
								<dd className="mt-1 text-gray-900">{config.block_admin_writes ? t('adminWrites.blocked') : t('adminWrites.allowed')}</dd>
							</div>
						</dl>
						<div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
							<p className="text-xs text-gray-500">{t('preview')}</p>
							<p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-900">{status.effective_message}</p>
						</div>
						<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
							{EXTEND_STEPS.map(step => <button key={step} type="button" disabled={busy}
								onClick={() => void handleExtend(step)} className={secondaryButtonClass}>{t('actions.extend', { minutes: step })}</button>)}
							<p className="basis-full text-xs text-gray-500 sm:ml-auto sm:basis-auto">{t('propagation', { seconds: status.propagation_seconds })}</p>
						</div>
					</>
				)}
			</section>

			{active ? (
				<ConfigCardShell
					id="maintenance-messages"
					title={t('configured.title')}
					description={t('configured.description')}
				>
					{hasCustomMessage ? (
						<dl className="space-y-3 text-sm">
							{config.message && (
								<div>
									<dt className="text-xs text-gray-500">{t('configured.default')}</dt>
									<dd className="mt-1 break-words text-gray-900">{config.message}</dd>
								</div>
							)}
							{customMessages.map(([lang, text]) => (
								<div key={lang}>
									<dt className="font-mono text-xs text-gray-500">{lang}</dt>
									<dd className="mt-1 break-words text-gray-900">{text}</dd>
								</div>
							))}
						</dl>
					) : (
						<p className="text-sm text-gray-500">{t('configured.builtin')}</p>
					)}
				</ConfigCardShell>
			) : (
				<ConfigCardShell id="maintenance-enable" title={t('settingsCard.title')} description={t('settingsCard.description')}
					footer={<div className="flex flex-wrap items-center justify-between gap-3">
						<span className="text-xs text-gray-500">{t('propagation', { seconds: status.propagation_seconds })}</span>
						<button type="button" disabled={busy || customInvalid} onClick={() => void handleEnable()}
							className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">
							{busy ? tCommon('saving') : t('actions.enable')}
						</button>
					</div>}>
					<div className="space-y-6">
						<fieldset disabled={busy} className="min-w-0">
							<legend className="sr-only">{t('form.duration')}</legend>
							<div className="grid gap-3 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-6">
								<p aria-hidden="true" className="pt-2 text-sm font-medium text-gray-700">{t('form.duration')}</p>
								<div className="min-w-0">
									<div className="flex flex-wrap gap-2">
										{([...DURATION_PRESETS, 'none', 'custom'] as Preset[]).map((option) => {
											const selected = preset === option;
											const label =
												option === 'none'
													? t('form.noDuration')
													: option === 'custom'
													? t('form.customMinutes')
													: t('form.minutes', { minutes: option });
											return (
												<button
													key={String(option)}
													type="button"
													aria-pressed={selected}
													onClick={() => setPreset(option)}
													className={`rounded-lg border px-3 py-2 text-sm ${
														selected
															? 'border-gray-900 bg-gray-900 font-medium text-white'
															: 'border-gray-200 text-gray-700 hover:bg-gray-50'
													}`}
												>
													{label}
												</button>
											);
										})}
									</div>
									{preset === 'custom' && (
										<div className="mt-3 max-w-[12rem]">
											<input
												type="number"
												min={1}
												step={1}
												inputMode="numeric"
												value={customMinutes}
												onChange={(event) => setCustomMinutes(event.target.value)}
												aria-label={t('form.customMinutes')}
												aria-invalid={customInvalid}
												className={`${inputClass} ${customInvalid ? 'border-red-400' : ''}`}
											/>
											{customInvalid ? (
												<p role="alert" className="mt-2 text-xs text-red-700">
													{ui('wholeMinutes')}
												</p>
											) : null}
										</div>
									)}
									<p className="mt-2 text-xs leading-relaxed text-gray-500">{t('form.durationHelp')}</p>
								</div>
							</div>
						</fieldset>
						<div className="grid gap-3 border-t border-gray-100 pt-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-6">
							<label htmlFor="maintenance-message" className="pt-2 text-sm font-medium text-gray-700">{t('form.message')}</label>
							<div className="min-w-0 space-y-3">
								<textarea
									id="maintenance-message"
									rows={2}
									maxLength={500}
									value={message}
									onChange={(event) => setMessage(event.target.value)}
									placeholder={t('form.messagePlaceholder', { token: MESSAGE_TOKEN })}
									disabled={busy}
									className={inputClass}
								/>
								<p className="mt-1 text-xs text-gray-500">
									{t('form.messageHelp', { token: MESSAGE_TOKEN })}
								</p>
								<details className="rounded-lg border border-gray-200 p-3">
									<summary className="cursor-pointer text-sm text-gray-600">{ui('localizedMessages')}</summary>
									<div className="mt-4">
										<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
											<div>
												<label htmlFor="maintenance-message-zh" className={labelClass}>
													{t('form.messageZh')}
												</label>
												<textarea
													id="maintenance-message-zh"
													rows={2}
													maxLength={500}
													value={messageZh}
													onChange={(event) => setMessageZh(event.target.value)}
													disabled={busy}
													className={inputClass}
												/>
											</div>
											<div>
												<label htmlFor="maintenance-message-en" className={labelClass}>
													{t('form.messageEn')}
												</label>
												<textarea
													id="maintenance-message-en"
													rows={2}
													maxLength={500}
													value={messageEn}
													onChange={(event) => setMessageEn(event.target.value)}
													disabled={busy}
													className={inputClass}
												/>
											</div>
										</div>
									</div>
								</details>
							</div>
						</div>
						<div className="grid gap-3 border-t border-gray-100 pt-6 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-6">
							<h3 className="text-sm font-medium text-gray-700">{t('form.impact')}</h3>
							<div className="min-w-0 space-y-3">
								<p className="text-sm leading-relaxed text-gray-500">{t('form.inferenceImpact')}</p>
								<label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
									<input
										type="checkbox"
										checked={blockAdmin}
										onChange={(event) => setBlockAdmin(event.target.checked)}
										disabled={busy}
										className="mt-0.5 h-4 w-4 rounded border-gray-200"
									/>
									<span>
										<span className="font-medium text-gray-900">{t('form.blockAdmin')}</span>
										<span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
											{t('form.blockAdminHelp')}
										</span>
									</span>
								</label>
							</div>
						</div>
					</div>
				</ConfigCardShell>
			)}
		</div>
	);
}
