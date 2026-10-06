'use client';

import { useState } from 'react';
import { CodeBracketIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import type { GatewayModel } from '@/lib/types';

const ALL_GROUPS = '*';
type FactorEntry = {
  row: { routeGroup: string; factor: string };
  index: number;
};
type FactorCard = { modelId: string; rows: FactorEntry[] };

type Props = {
  cards: FactorCard[];
  models: ReadonlyMap<string, Pick<GatewayModel, 'id' | 'display_name' | 'vendor'>>;
  groupsByModel: ReadonlyMap<string, string[]>;
  groupsLoaded: boolean;
  configPreview: { json: string | null; error: string | null; dirty: boolean };
  onAddModel: () => void;
  onAddGroup: (modelId: string, group: string) => void;
  onUpdateRow: (index: number, patch: { routeGroup?: string; factor?: string }) => void;
  onRemoveRow: (index: number) => void;
  onRemoveModel: (modelId: string) => void;
};

function MultiplierInput({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative w-20 shrink-0">
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-gray-300 bg-white pl-2 pr-6 text-right font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden>
        ×
      </span>
    </div>
  );
}

export function UserFactorEditor({
  cards,
  models,
  groupsByModel,
  groupsLoaded,
  configPreview,
  onAddModel,
  onAddGroup,
  onUpdateRow,
  onRemoveRow,
  onRemoveModel,
}: Props) {
  const t = useTranslations('users');
  const te = useTranslations('users.chargedCostFactors.editor');
  const tCommon = useTranslations('common');
  const [search, setSearch] = useState('');
  const [showJson, setShowJson] = useState(false);
  const query = search.trim().toLocaleLowerCase();
  const visibleCards = cards.filter((card) => {
    const model = models.get(card.modelId);
    return !query || `${card.modelId} ${model?.display_name ?? ''}`.toLocaleLowerCase().includes(query);
  });
  return (
    <section
      id="user-factor-editor"
      aria-labelledby="user-factor-editor-title"
      className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="user-factor-editor-title" className="text-lg font-semibold text-gray-900">
              {t('fields.chargedCostFactors')}
            </h2>
            <InfoHintPopover label={t('fields.chargedCostFactors')} portal openOnHover align="start">
              <p>{t('help.chargedCostFactors')}</p>
              <p className="mt-2">{te('factorHint')}</p>
            </InfoHintPopover>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              {te('modelCount', { count: cards.length })}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">{te('priorityHint')}</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-48">
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={te('searchModels')}
              placeholder={te('searchModels')}
              className="h-8 w-full rounded-md border border-gray-300 bg-white pl-8 pr-2 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowJson((prev) => !prev)}
            aria-label={showJson ? te('hideJson') : te('viewJson')}
            aria-expanded={showJson}
            aria-controls="user-factor-json-preview"
            title={showJson ? te('hideJson') : te('viewJson')}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-300 px-2 text-xs text-gray-600 hover:bg-gray-50"
          >
            <CodeBracketIcon className="h-4 w-4" aria-hidden />
            JSON
          </button>
          <button
            type="button"
            onClick={onAddModel}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <PlusIcon className="h-4 w-4" aria-hidden />
            {te('addModel')}
          </button>
        </div>
      </div>
      {cards.length === 0 ? (
        <p className="border-t border-gray-100 px-4 py-8 text-center text-sm text-gray-500">
          {t('chargedCostFactors.empty')}
        </p>
      ) : (
        <table className="block w-full table-fixed text-left lg:table">
          <colgroup className="hidden lg:table-column-group">
            <col className="w-64 xl:w-72" />
            <col className="w-40" />
            <col />
            <col className="w-12" />
          </colgroup>
          <thead className="hidden border-y border-gray-200 bg-gray-50 text-xs text-gray-500 lg:table-header-group">
            <tr>
              <th scope="col" className="px-6 py-2 font-medium">
                {te('modelColumn')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <div className="flex items-center gap-1.5">
                  {te('defaultFactor')}
                  <InfoHintPopover label={te('defaultFactor')} portal openOnHover align="start">
                    <p>{te('defaultHint')}</p>
                  </InfoHintPopover>
                </div>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {te('overrides')}
              </th>
              <th scope="col">
                <span className="sr-only">{te('actionsColumn')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {visibleCards.map((card) => {
              const model = models.get(card.modelId);
              const label = model?.display_name?.trim() || card.modelId;
              const knownGroups = groupsByModel.get(card.modelId) ?? [];
              const usedGroups = new Set(card.rows.map(({ row }) => row.routeGroup));
              const availableGroups = knownGroups.filter((group) => !usedGroups.has(group));
              const defaultEntry = card.rows.find(({ row }) => row.routeGroup === ALL_GROUPS);
              const overrides = card.rows.filter(({ row }) => row.routeGroup !== ALL_GROUPS);
              return (
                <tr
                  key={card.modelId}
                  aria-label={label}
                  className="relative block border-t border-gray-100 px-4 py-3 hover:bg-gray-50/60 lg:table-row lg:border-t-0 lg:border-b lg:p-0 last:border-b-0"
                >
                  <th
                    scope="row"
                    className="block min-w-0 pr-8 text-left align-top font-normal lg:table-cell lg:px-6 lg:py-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <ModelVendorIcon vendor={model?.vendor || 'unknown'} size="compact" />
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium text-gray-900" title={label}>
                          {label}
                        </span>
                        <span
                          className="mt-0.5 block truncate font-mono text-[11px] text-gray-500"
                          title={card.modelId}
                        >
                          {card.modelId}
                        </span>
                        {!model && (
                          <span className="mt-1 block text-xs text-amber-700">
                            {t('chargedCostFactors.unknownModel')}
                          </span>
                        )}
                      </div>
                    </div>
                  </th>
                  <td className="mt-3 block align-top lg:mt-0 lg:table-cell lg:px-3 lg:py-3">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500 lg:hidden">
                      {te('defaultFactor')}
                    </span>
                    {defaultEntry ? (
                      <div className="flex items-center gap-1">
                        <MultiplierInput
                          value={defaultEntry.row.factor}
                          label={te('defaultInput', { model: label })}
                          onChange={(value) => onUpdateRow(defaultEntry.index, { factor: value })}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveRow(defaultEntry.index)}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={te('removeDefault', { model: label })}
                          title={te('removeDefault', { model: label })}
                        >
                          <XMarkIcon className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAddGroup(card.modelId, ALL_GROUPS)}
                        aria-label={te('setDefaultFor', { model: label })}
                        title={`${te('inherited')} ${te('setDefault')}`}
                        className="inline-flex h-8 max-w-full items-center gap-2 whitespace-nowrap rounded-md border border-dashed border-gray-300 bg-white px-2 text-xs text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                      >
                        <span className="min-w-0 truncate">{te('routeBilling')}</span>
                        <PlusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      </button>
                    )}
                  </td>
                  <td className="mt-3 block min-w-0 align-top lg:mt-0 lg:table-cell lg:px-3 lg:py-3">
                    <span className="mb-1.5 block text-xs font-medium text-gray-500 lg:hidden">{te('overrides')}</span>
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                      {overrides.map(({ row, index }) => {
                        const known = !groupsLoaded || knownGroups.includes(row.routeGroup);
                        const options = [
                          ...new Set([
                            row.routeGroup,
                            ...knownGroups.filter((group) => group === row.routeGroup || !usedGroups.has(group)),
                          ]),
                        ];
                        return (
                          <div key={`${card.modelId}:${row.routeGroup}:${index}`} className="min-w-0">
                            <div className="flex items-center gap-1">
                              <select
                                aria-label={`${label} · ${t('chargedCostFactors.groupLabel')} · ${row.routeGroup}`}
                                value={row.routeGroup}
                                title={row.routeGroup}
                                onChange={(event) =>
                                  onUpdateRow(index, {
                                    routeGroup: event.target.value,
                                  })
                                }
                                className="h-8 w-28 min-w-0 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                              >
                                {options.map((group) => (
                                  <option key={group} value={group}>
                                    {group}
                                  </option>
                                ))}
                              </select>
                              <MultiplierInput
                                value={row.factor}
                                label={`${label} · ${row.routeGroup} · ${t('fields.chargedCostFactorValue')}`}
                                onChange={(value) => onUpdateRow(index, { factor: value })}
                              />
                              <button
                                type="button"
                                onClick={() => onRemoveRow(index)}
                                className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                aria-label={te('removeOverride', {
                                  model: label,
                                  group: row.routeGroup,
                                })}
                                title={te('removeOverride', {
                                  model: label,
                                  group: row.routeGroup,
                                })}
                              >
                                <XMarkIcon className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                            {!known && (
                              <p className="mt-1 text-[11px] text-amber-700">{t('chargedCostFactors.unknownGroup')}</p>
                            )}
                          </div>
                        );
                      })}
                      {availableGroups.length > 0 ? (
                        <select
                          value=""
                          aria-label={te('chooseGroupFor', { model: label })}
                          onChange={(event) => {
                            if (event.target.value) onAddGroup(card.modelId, event.target.value);
                          }}
                          className="h-8 max-w-full rounded-md border border-dashed border-indigo-200 bg-white px-2 text-xs text-indigo-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        >
                          <option value="" disabled>
                            {te('addGroup')}
                          </option>
                          {availableGroups.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      ) : overrides.length === 0 ? (
                        <span className="py-2 text-xs text-gray-400">
                          {!groupsLoaded ? tCommon('loading') : te('noRouteGroups')}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="absolute right-3 top-3 lg:static lg:table-cell lg:py-3 lg:pr-3 lg:align-top">
                    <button
                      type="button"
                      onClick={() => onRemoveModel(card.modelId)}
                      className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={te('removeModel', { model: label })}
                      title={te('removeModel', { model: label })}
                    >
                      <TrashIcon className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleCards.length === 0 && (
              <tr className="block lg:table-row">
                <td colSpan={4} className="block px-4 py-8 text-center text-sm text-gray-500 lg:table-cell">
                  {te('noMatchingModels')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {showJson && (
        <div
          id="user-factor-json-preview"
          role="region"
          aria-label={te('jsonTitle')}
          className="border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-xs font-medium text-gray-700">charged_cost_factors</h3>
            {configPreview.dirty && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{t('detailUx.unsaved')}</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">{te('jsonHint')}</p>
          {configPreview.error ? (
            <p role="status" className="mt-2 text-xs text-red-600">
              {configPreview.error}
            </p>
          ) : (
            <pre
              tabIndex={0}
              aria-label={te('jsonTitle')}
              className="mt-2 max-h-64 overflow-auto rounded-md border border-gray-200 bg-white p-3 font-mono text-xs leading-5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              {configPreview.json}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
