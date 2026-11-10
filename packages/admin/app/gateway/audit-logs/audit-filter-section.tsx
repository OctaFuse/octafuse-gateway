'use client';
import { useTranslations } from 'next-intl';

export function AuditFilterSection({
  label,
  options,
  selected,
  onChange,
  defaultValue,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[] | null) => void;
  defaultValue?: string[];
}) {
  const t = useTranslations('common');
  const audit = useTranslations('auditLogs');
  return (
    <details className="rounded-lg border border-gray-200 p-3">
      <summary className="cursor-pointer text-sm text-gray-700">
        {label}
        <span className="ml-2 text-xs tabular-nums text-gray-500">
          {selected.length} / {options.length}
        </span>
      </summary>
      <fieldset className="mt-3">
        <legend className="sr-only">{label}</legend>
        <div className="mb-2 flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-gray-600 hover:underline"
            disabled={!options.length}
          >
            {t('selectAll')}
          </button>
          {defaultValue && (
            <button
              type="button"
              onClick={() => onChange(defaultValue)}
              className="text-gray-600 hover:underline"
            >
              {audit('filters.defaultEventTypes')}
            </button>
          )}
        </div>
        <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
              title={option.value}
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                disabled={selected.includes(option.value) && selected.length <= 1}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value)
                  )
                }
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-gray-950"
              />
              <span className="break-words [overflow-wrap:anywhere]">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </details>
  );
}
