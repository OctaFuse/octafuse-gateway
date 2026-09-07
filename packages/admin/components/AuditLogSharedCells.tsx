'use client';

/**
 * 审计日志行共用单元格（时间 / 事件 / 操作者 / 身份可选 / 周期额度 / 周期计划 / 永久额度 / 变更详情）。
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatGatewayMoneyCode } from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { summarizeWalletSnapshotDiff } from '@/lib/audit-user-snapshot-diff';
import { AuditWalletPlanBlock } from '@/components/AuditWalletPlanBlock';
import { AuditChangedPair } from '@/components/AuditChangedPair';
import {
	auditDiffRows,
	auditDisplayExtras,
	auditEnumLabel,
	auditReasonOneLine,
	auditSummaryDiffRows,
	budgetMoneySemanticallyEqual,
	budgetResetAtSemanticallyEqual,
	formatAuditTime,
	formatBudgetMax,
	formatSignedMoney,
	parseAuditActorId,
	shortAuditId,
} from '@/lib/audit-log-display';
import type { GatewayApiKeyBudgetAuditLog } from '@/lib/types';

export function AuditLogSharedCells({
	item,
	currency,
	timezone,
	onViewDetail,
	showIdentity = true,
}: {
	item: GatewayApiKeyBudgetAuditLog;
	currency: string;
	timezone: string;
	onViewDetail: (item: GatewayApiKeyBudgetAuditLog) => void;
	showIdentity?: boolean;
}) {
	const t = useTranslations('auditLogs');
	const ex = auditDisplayExtras(item);
	const maxChanged = !budgetMoneySemanticallyEqual(item.before_budget_max, item.after_budget_max);
	const baseChanged = !budgetMoneySemanticallyEqual(item.before_budget_base, item.after_budget_base);
	const spentChanged = !budgetMoneySemanticallyEqual(item.before_spent, item.after_spent);
	const periodChanged = (ex.before_budget_period ?? '') !== (ex.after_budget_period ?? '');
	const resetChanged = !budgetResetAtSemanticallyEqual(ex.before_budget_reset_at, ex.after_budget_reset_at);
	const walletDiff = summarizeWalletSnapshotDiff(item.before_user_snapshot, item.after_user_snapshot);
	const reasonDisplay = auditReasonOneLine(ex.reason_code, ex.reason_text);
	const diffRows = auditDiffRows(item);
	const summaryDiffRows = auditSummaryDiffRows(diffRows);

	return (
		<>
			<td className="px-3 py-2 align-top">
				<div className="whitespace-nowrap text-gray-700">{formatAuditTime(item.created_at, timezone)}</div>
				<div
					className="mt-0.5 whitespace-nowrap font-mono text-xs text-gray-600"
					title={item.request_log_id || undefined}
				>
					{t('labels.req')}: {item.request_log_id ? shortAuditId(item.request_log_id) : '—'}
				</div>
				{ex.correlation_id ? (
					<div className="mt-0.5 whitespace-nowrap font-mono text-xs text-gray-500" title={ex.correlation_id}>
						{t('labels.corr')}: {shortAuditId(ex.correlation_id)}
					</div>
				) : null}
			</td>
			<td className="min-w-0 max-w-[15rem] px-3 py-2 align-top">
				<div className="space-y-1.5 text-xs leading-snug">
					<div className="min-w-0">
						<span className="text-gray-500">{t('labels.type')}</span>
						<span className="text-sm font-medium text-gray-900" title={item.event_type}>
							{auditEnumLabel(t, 'eventTypes', item.event_type)}
						</span>
					</div>
					<div className="min-w-0 truncate text-[11px]" title={ex.source || undefined}>
						<span className="text-gray-500">{t('labels.from')}</span>
						<span className="text-violet-800">{auditEnumLabel(t, 'sourceChannels', ex.source)}</span>
					</div>
					<div className="min-w-0 line-clamp-3 text-gray-800" title={reasonDisplay.title || undefined}>
						<span className="text-gray-500">{t('labels.reason')}</span>
						<span className={reasonDisplay.isMono ? 'font-mono text-[11px] text-gray-900' : 'text-[11px]'}>
							{reasonDisplay.line}
						</span>
					</div>
				</div>
			</td>
			<td className="min-w-0 max-w-[12rem] px-3 py-2 align-top">
				<div className="space-y-1.5 text-xs leading-snug">
					<div>
						<span className="text-gray-500">{t('labels.kind')}</span>
						<span className="text-sm text-gray-900" title={item.actor_type}>
							{auditEnumLabel(t, 'actorTypes', item.actor_type)}
						</span>
					</div>
					<div className="min-w-0">
						<span className="text-gray-500">{t('labels.principal')}</span>
						{ex.actor_id ? (
							(() => {
								const { kind, identifier } = parseAuditActorId(ex.actor_id);
								return (
									<span className="inline-flex min-w-0 flex-wrap items-baseline gap-1" title={ex.actor_id}>
										{kind ? (
											<span className="rounded bg-gray-100 px-1 text-[10px] text-gray-700" title={kind}>
												{auditEnumLabel(t, 'actorKinds', kind)}
											</span>
										) : null}
										<span className="break-all font-mono text-[11px] text-gray-700">{shortAuditId(identifier)}</span>
									</span>
								);
							})()
						) : (
							<span className="text-gray-400">—</span>
						)}
					</div>
				</div>
			</td>
			{showIdentity ? (
				<td className="min-w-0 max-w-[18rem] px-3 py-2 align-top">
					<div className="truncate text-sm leading-snug text-gray-900" title={item.user_email || ''}>
						{item.user_email || '—'}
					</div>
					{item.user_id ? (
						<div className="mt-0.5 flex min-w-0 items-baseline gap-1 font-mono text-xs">
							<span className="shrink-0 text-gray-600">{t('labels.user')}</span>
							<Link
								href={`/gateway/users/${encodeURIComponent(item.user_id)}`}
								className="min-w-0 truncate text-blue-600 hover:underline"
								title={item.user_id}
							>
								{shortAuditId(item.user_id)}
							</Link>
						</div>
					) : (
						<div className="mt-0.5 truncate font-mono text-xs text-gray-400" title={t('userRemovedTitle')}>
							{t('labels.user')} —
						</div>
					)}
					<div className="mt-0.5 truncate font-mono text-xs leading-snug text-gray-500" title={item.api_key_id ?? ''}>
						{t('labels.key')}
						{item.api_key_id ? shortAuditId(item.api_key_id) : '—'}
					</div>
				</td>
			) : null}
			<td className="min-w-[14rem] px-3 py-2 align-top text-xs text-gray-600">
				<div className="space-y-1 leading-snug">
					<div>
						<span className="font-medium text-gray-700">{t('labels.spent')}</span>{' '}
						{spentChanged ? (
							<span className="inline-block align-top">
								<AuditChangedPair
									changed
									before={formatGatewayMoneyCode(item.before_spent, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
									after={formatGatewayMoneyCode(item.after_spent, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
								/>
								<div
									className={
										item.delta_spent > 0
											? 'text-red-600'
											: item.delta_spent < 0
												? 'text-green-600'
												: 'text-gray-500'
									}
								>
									{formatSignedMoney(item.delta_spent, currency)}
								</div>
							</span>
						) : (
							formatGatewayMoneyCode(item.after_spent, currency, GATEWAY_MONEY_DECIMAL_PLACES)
						)}
					</div>
					<div>
						<span className="font-medium text-gray-700">{t('labels.max')}</span>{' '}
						<AuditChangedPair
							changed={maxChanged}
							before={formatBudgetMax(item.before_budget_max, currency)}
							after={formatBudgetMax(item.after_budget_max, currency)}
						/>
					</div>
					<div>
						<span className="font-medium text-gray-700">{t('labels.base')}</span>{' '}
						<AuditChangedPair
							changed={baseChanged}
							before={formatGatewayMoneyCode(item.before_budget_base, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
							after={formatGatewayMoneyCode(item.after_budget_base, currency, GATEWAY_MONEY_DECIMAL_PLACES)}
						/>
					</div>
				</div>
			</td>
			<td className="min-w-[12rem] px-3 py-2 align-top text-xs text-gray-600">
				<div className="space-y-1 leading-snug">
					<div>
						<span className="font-medium text-gray-700">{t('labels.period')}</span>{' '}
						<AuditChangedPair
							changed={periodChanged}
							before={ex.before_budget_period ?? '—'}
							after={ex.after_budget_period ?? '—'}
						/>
					</div>
					<div>
						<span className="font-medium text-gray-700">{t('labels.resetAt')}</span>{' '}
						<span className="whitespace-nowrap">
							<AuditChangedPair
								changed={resetChanged}
								before={formatAuditTime(ex.before_budget_reset_at, timezone)}
								after={formatAuditTime(ex.after_budget_reset_at, timezone)}
							/>
						</span>
					</div>
				</div>
			</td>
			<td className="min-w-[14rem] px-3 py-2 align-top text-xs text-gray-600">
				<AuditWalletPlanBlock
					diff={walletDiff}
					currency={currency}
					labels={{
						granted: t('labels.granted'),
						spent: t('labels.spent'),
						remaining: t('labels.remaining'),
					}}
				/>
			</td>
			<td className="min-w-[14rem] max-w-lg px-3 py-2 align-top text-gray-600">
				<div className="space-y-1 text-xs leading-snug">
					{summaryDiffRows.length > 0 ? (
						<>
							{summaryDiffRows.slice(0, 3).map((row, index) => (
								<div key={`${item.id}-diff-${index}`} className="grid grid-cols-[minmax(5rem,8rem)_1fr] gap-x-2">
									<span className="truncate font-mono text-gray-700" title={row.field}>
										{row.field}
									</span>
									<span className="min-w-0 truncate" title={`${row.before} → ${row.after}`}>
										<span className="text-amber-700">{row.before}</span>
										<span className="px-1 text-gray-400">→</span>
										<span className="text-sky-700">{row.after}</span>
									</span>
								</div>
							))}
							<button
								type="button"
								onClick={() => onViewDetail(item)}
								className="mt-1 text-xs text-blue-600 hover:underline"
							>
								{t('labels.viewChangeDetail')}
								{summaryDiffRows.length > 3 ? ` · ${t('labels.more', { count: summaryDiffRows.length - 3 })}` : ''}
							</button>
						</>
					) : (
						<>
							<span className="text-gray-400">—</span>
							{diffRows.length > 0 ? (
								<button
									type="button"
									onClick={() => onViewDetail(item)}
									className="ml-2 text-xs text-blue-600 hover:underline"
								>
									{t('labels.viewChangeDetail')}
								</button>
							) : null}
						</>
					)}
				</div>
			</td>
		</>
	);
}

export function AuditChangeDetailModal({
	item,
	timezone,
	onClose,
}: {
	item: GatewayApiKeyBudgetAuditLog;
	timezone: string;
	onClose: () => void;
}) {
	const t = useTranslations('auditLogs');
	const tCommon = useTranslations('common');
	const detailRows = auditDiffRows(item);
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			role="dialog"
			aria-modal="true"
			aria-labelledby="audit-change-detail-title"
		>
			<div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
				<div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
					<div className="min-w-0">
						<h2 id="audit-change-detail-title" className="text-lg font-semibold text-gray-900">
							{t('labels.changeDetailTitle')}
						</h2>
						<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
							<span title={item.event_type}>{auditEnumLabel(t, 'eventTypes', item.event_type)}</span>
							<span>{formatAuditTime(item.created_at, timezone)}</span>
							<span className="truncate">{item.user_email ?? '—'}</span>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
					>
						{tCommon('close')}
					</button>
				</div>
				<div className="overflow-y-auto p-5">
					{detailRows.length > 0 ? (
						<div className="space-y-3">
							{detailRows.map((row, index) => (
								<div key={`${row.group}-${row.field}-${index}`} className="rounded-lg border border-gray-200 bg-white p-3">
									<div className="mb-2 flex flex-wrap items-center gap-2">
										<span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
											{row.group === 'snapshot' ? t('labels.userSnapshot') : t('labels.extraJson')}
										</span>
										<span className="min-w-0 break-all font-mono text-sm font-medium text-gray-900">{row.field}</span>
									</div>
									<div className="grid gap-3 md:grid-cols-2">
										<div className="min-w-0">
											<div className="mb-1 text-xs font-medium uppercase text-gray-500">{t('labels.originalValue')}</div>
											<pre className="max-w-full whitespace-pre-wrap break-all rounded bg-amber-50 px-3 py-2 font-mono text-xs leading-relaxed text-amber-900">
												{row.before}
											</pre>
										</div>
										<div className="min-w-0">
											<div className="mb-1 text-xs font-medium uppercase text-gray-500">{t('labels.changedValue')}</div>
											<pre className="max-w-full whitespace-pre-wrap break-all rounded bg-sky-50 px-3 py-2 font-mono text-xs leading-relaxed text-sky-900">
												{row.after}
											</pre>
										</div>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="py-8 text-center text-sm text-gray-500">{t('labels.noChangeDetail')}</div>
					)}
				</div>
			</div>
		</div>
	);
}
