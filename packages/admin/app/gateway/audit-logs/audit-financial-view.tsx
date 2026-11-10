'use client';
import { useTranslations } from 'next-intl';
import {
  formatGatewayMoneyCode,
  formatGatewayMoneyCodeSigned,
} from '@/lib/format-gateway-currency';
import { GATEWAY_MONEY_DECIMAL_PLACES } from '@/lib/gateway-money';
import { formatAuditTime } from '@/lib/audit-log-display';
import type { AuditValueRow } from './audit-log-presentation';

function valueText(
  row: AuditValueRow,
  value: AuditValueRow['before'],
  currency: string,
  timezone: string,
  noLimit: string,
  period: (value: string) => string
) {
  if (row.kind === 'limit' && value == null) return noLimit;
  if (value == null || value === '') return '—';
  if (row.kind === 'date') return formatAuditTime(String(value), timezone);
  if (row.kind === 'period') return period(String(value));
  return formatGatewayMoneyCode(Number(value), currency, GATEWAY_MONEY_DECIMAL_PLACES);
}
export function AuditFinancialView({
  rows,
  currency,
  timezone,
  summary = false,
}: {
  rows: AuditValueRow[];
  currency: string;
  timezone: string;
  summary?: boolean;
}) {
  const t = useTranslations('auditLogs');
  const common = useTranslations('common');
  const options = useTranslations('options');
  const text = (row: AuditValueRow, value: AuditValueRow['before']) =>
    valueText(row, value, currency, timezone, common('noLimit'), (value) =>
      options.has(`budgetPeriod.${value}`) ? options(`budgetPeriod.${value}`) : value
    );
  if (!rows.length) return <span className="text-xs text-gray-400">{t('ui.notRecorded')}</span>;
  if (summary) {
    const changed = rows.filter((row) => row.changed);
    return changed.length ? (
      <div className="space-y-1 text-xs">
        {changed.slice(0, 2).map((row) => (
          <div
            key={row.key}
            className="flex min-w-0 items-baseline gap-2"
            title={`${t(`ui.fields.${row.key}`)}: ${text(row, row.before)} → ${text(
              row,
              row.after
            )}`}
          >
            <span className="shrink-0 text-gray-500">{t(`ui.fields.${row.key}`)}</span>
            <span className="min-w-0 truncate font-medium tabular-nums text-gray-800">
              {row.delta != null
                ? formatGatewayMoneyCodeSigned(row.delta, currency, GATEWAY_MONEY_DECIMAL_PLACES)
                : text(row, row.after)}
            </span>
          </div>
        ))}
        {changed.length > 2 && (
          <p className="text-xs text-gray-400">{t('labels.more', { count: changed.length - 2 })}</p>
        )}
      </div>
    ) : (
      <span className="text-xs text-gray-400">{t('ui.unchanged')}</span>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[16rem] text-left text-xs">
        <thead className="border-b border-gray-200 text-gray-500">
          <tr>
            <th className="pb-2 font-normal">{t('labels.field')}</th>
            <th className="pb-2 text-right font-normal">{t('labels.before')}</th>
            <th className="pb-2 text-right font-normal">{t('labels.after')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-gray-100 last:border-0">
              <th className="py-2 pr-2 align-top font-normal text-gray-600">
                {t(`ui.fields.${row.key}`)}
              </th>
              <td
                className={`px-2 py-2 text-right align-top tabular-nums ${
                  row.changed ? 'text-amber-700' : 'text-gray-400'
                }`}
              >
                {text(row, row.before)}
              </td>
              <td
                className={`py-2 text-right align-top tabular-nums ${
                  row.changed ? 'font-medium text-sky-800' : 'text-gray-600'
                }`}
              >
                {text(row, row.after)}
                {row.delta != null && row.changed && (
                  <span className="mt-1 block text-[11px] text-gray-500">
                    {t('labels.delta')}:{' '}
                    {formatGatewayMoneyCodeSigned(
                      row.delta,
                      currency,
                      GATEWAY_MONEY_DECIMAL_PLACES
                    )}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
