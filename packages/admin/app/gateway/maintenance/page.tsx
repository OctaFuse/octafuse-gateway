'use client';

/**
 * 维护模式：开启后 Proxy 对推理请求返回友好的 503，可选同时冻结 Admin 写接口。
 * 数据迁移的"核心切换"依赖它冻结写入，也可单独用于任何维护窗口。
 * 版式与 `/gateway/config` 一致：标题区 + `ConfigCardShell` 卡片网格。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { MAINTENANCE_CHANGED_EVENT } from '@/components/layout/MaintenanceBanner';
import type { MaintenanceStatus } from '@/lib/services/admin/maintenance-service';

const DURATION_PRESETS = [5, 15, 30, 60] as const;
const EXTEND_STEPS = [15, 30, 60] as const;
const REFRESH_MS = 30_000;
const MESSAGE_TOKEN = '{minutes}';

type Preset = 'none' | 'custom' | (typeof DURATION_PRESETS)[number];

const inputClass =
	'w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700';
const secondaryButtonClass =
	'rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

export default function MaintenancePage() {
	const t = useTranslations('maintenance');
	const tCommon = useTranslations('common');
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
		try {
			const response = await fetch('/api/admin/maintenance', { cache: 'no-store' });
			const data = await readApiJson<MaintenanceStatus>(response);
			if (!response.ok || !data.success || !data.data) {
				throw new Error(data.message || tCommon('requestFailed'));
			}
			setStatus(data.data);
			setLoadError('');
		} catch (cause) {
			setLoadError(cause instanceof Error ? cause.message : t('loadFailed'));
		}
	}, [t, tCommon]);

	useEffect(() => {
		void load();
		const timer = window.setInterval(() => void load(), REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [load]);

	const save = async (body: Record<string, unknown>, successKey: 'enabled' | 'extended' | 'disabled') => {
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
			window.dispatchEvent(new Event(MAINTENANCE_CHANGED_EVENT));
			notify('success', t(`toast.${successKey}`), t('propagation', { seconds: data.data.propagation_seconds }));
		} catch (cause) {
			notify('error', cause instanceof Error ? cause.message : tCommon('requestFailed'));
		} finally {
			setBusy(false);
		}
	};

	const durationMinutes = (): number | null => {
		if (preset === 'none') return null;
		if (preset === 'custom') {
			const parsed = Number(customMinutes);
			return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.NaN;
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

	const header = (
		<div className="mb-6">
			<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
			<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
		</div>
	);

	if (!status && !loadError) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	if (!status) {
		return (
			<div className="p-4 sm:p-6 lg:p-8">
				<h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
				<div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
					<p className="font-medium text-red-800">{t('loadFailed')}</p>
					<p className="mt-1 text-sm text-red-700">{loadError}</p>
					<button
						type="button"
						onClick={() => void load()}
						className="mt-4 rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-800"
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
		<div className="min-w-0 p-4 sm:p-6 lg:p-8">
			{header}

			{loadError && (
				<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
					{loadError}
				</div>
			)}

			<div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
				<ConfigCardShell
					id="maintenance-status"
					title={t('statusCard.title')}
					description={active ? t('onHint') : t('offHint')}
					footer={
						active ? (
							<div className="space-y-3">
								<div className="flex flex-wrap items-center gap-2">
									{EXTEND_STEPS.map((step) => (
										<button
											key={step}
											type="button"
											disabled={busy}
											onClick={() => void handleExtend(step)}
											className={secondaryButtonClass}
										>
											{t('actions.extend', { minutes: step })}
										</button>
									))}
									<button
										type="button"
										disabled={busy}
										onClick={() => void handleDisable()}
										className="ml-auto rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
									>
										{busy ? tCommon('saving') : t('actions.disable')}
									</button>
								</div>
								<p className="text-xs text-gray-500">{t('propagation', { seconds: status.propagation_seconds })}</p>
							</div>
						) : undefined
					}
				>
					<div aria-live="polite">
						<span
							className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
								active
									? 'bg-red-50 text-red-700 ring-red-200'
									: 'bg-emerald-50 text-emerald-700 ring-emerald-200'
							}`}
						>
							<span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
							{active ? t('state.on') : t('state.off')}
						</span>
					</div>

					{active && (
						<dl className="mt-4 space-y-3 text-sm">
							<div>
								<dt className="text-xs text-gray-500">{t('preview')}</dt>
								<dd className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900">
									{status.effective_message}
								</dd>
							</div>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<dt className="text-xs text-gray-500">{t('expectedEnd')}</dt>
									<dd className="mt-1 text-gray-900">
										{expectedEnd ? formatDateTime(expectedEnd) : t('noEta')}
										{expectedEnd && (
											<span className="ml-2 text-xs text-gray-500">
												{status.remaining_minutes !== null
													? t('remaining', { minutes: status.remaining_minutes })
													: t('overdue')}
											</span>
										)}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-gray-500">{t('adminWrites.label')}</dt>
									<dd className="mt-1 text-gray-900">
										{config.block_admin_writes ? t('adminWrites.blocked') : t('adminWrites.allowed')}
									</dd>
								</div>
							</div>
						</dl>
					)}
				</ConfigCardShell>

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
					<ConfigCardShell
						id="maintenance-enable"
						title={t('settingsCard.title')}
						description={t('settingsCard.description')}
						footer={
							<div className="flex flex-wrap items-center justify-between gap-3">
								<span className="text-xs text-gray-500">{t('propagation', { seconds: status.propagation_seconds })}</span>
								<button
									type="button"
									disabled={busy || customInvalid}
									onClick={() => void handleEnable()}
									className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{busy ? tCommon('saving') : t('actions.enable')}
								</button>
							</div>
						}
					>
						<div className="space-y-5">
							<fieldset disabled={busy}>
								<legend className={labelClass}>{t('form.duration')}</legend>
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
												className={`rounded-md border px-3 py-2 text-sm ${
													selected
														? 'border-gray-900 bg-gray-900 font-medium text-white'
														: 'border-gray-300 text-gray-700 hover:bg-gray-50'
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
									</div>
								)}
							</fieldset>

							<div>
								<label htmlFor="maintenance-message" className={labelClass}>
									{t('form.message')}
								</label>
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
								<p className="mt-1 text-xs text-gray-500">{t('form.messageHelp', { token: MESSAGE_TOKEN })}</p>
							</div>

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

							<label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm">
								<input
									type="checkbox"
									checked={blockAdmin}
									onChange={(event) => setBlockAdmin(event.target.checked)}
									disabled={busy}
									className="mt-0.5 h-4 w-4 rounded border-gray-300"
								/>
								<span>
									<span className="font-medium text-gray-900">{t('form.blockAdmin')}</span>
									<span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{t('form.blockAdminHelp')}</span>
								</span>
							</label>
						</div>
					</ConfigCardShell>
				)}
			</div>
		</div>
	);
}
