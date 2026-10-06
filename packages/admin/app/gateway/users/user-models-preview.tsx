'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { readApiJson } from '@/lib/api-json';
import type { UserModelsPreview } from '@/lib/services/admin/user-models-preview';

type Kind = UserModelsPreview['preview']['kind'];

export function UserModelsPreviewPanel({ userId, factorsDirty }: { userId: string; factorsDirty: boolean }) {
	const t = useTranslations('users.modelsPreview');
	const [model, setModel] = useState('');
	const [routeGroups, setRouteGroups] = useState('default,free');
	const [kind, setKind] = useState<Kind>('llm');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [result, setResult] = useState<UserModelsPreview | null>(null);

	const request = async () => {
		setLoading(true);
		setError('');
		try {
			const params = new URLSearchParams({ route_groups: routeGroups, kind });
			const query = model.trim();
			if (query) params.set('model', query);
			const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/models?${params.toString()}`);
			const data = await readApiJson<UserModelsPreview>(res);
			if (!data.success || !data.data) {
				setResult(null);
				setError(data.message || t('failed'));
				return;
			}
			setResult(data.data);
		} catch (err) {
			setResult(null);
			setError(err instanceof Error ? err.message : t('failed'));
		} finally {
			setLoading(false);
		}
	};

	const payload = result ? { object: result.object, data: result.data } : null;

	return (
		<section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
			<div className="mb-1 flex flex-wrap items-center justify-between gap-2">
				<h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
				{result ? (
					<span className="text-xs text-gray-500">{t('mode', { mode: result.preview.user_charged_factor_mode })}</span>
				) : null}
			</div>
			<p className="mb-4 text-xs leading-5 text-gray-500">{t('hint')}</p>
			{factorsDirty ? <p className="mb-3 text-xs text-amber-700">{t('dirty')}</p> : null}
			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
				<div className="min-w-0">
					<div className="flex flex-wrap items-end gap-2">
						<label className="block min-w-[9rem] flex-1 text-[11px] font-medium text-gray-500">
							{t('model')}
							<input
								value={model}
								onChange={(event) => setModel(event.target.value)}
								placeholder={t('modelPlaceholder')}
								className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs font-normal text-gray-900"
							/>
						</label>
						<label className="block w-32 text-[11px] font-medium text-gray-500">
							{t('routeGroups')}
							<input
								value={routeGroups}
								onChange={(event) => setRouteGroups(event.target.value)}
								className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 font-mono text-xs font-normal text-gray-900"
							/>
						</label>
						<label className="block w-24 text-[11px] font-medium text-gray-500">
							{t('kind')}
							<select
								value={kind}
								onChange={(event) => setKind(event.target.value as Kind)}
								className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs font-normal text-gray-900"
							>
								<option value="llm">llm</option>
								<option value="image">image</option>
								<option value="audio">audio</option>
								<option value="all">all</option>
							</select>
						</label>
						<button
							type="button"
							onClick={() => void request()}
							disabled={loading}
							className="h-8 rounded-md bg-gray-900 px-3 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-60"
						>
							{loading ? t('requesting') : t('request')}
						</button>
					</div>
					{error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
					{result && result.data.length === 0 ? <p className="mt-3 text-sm text-gray-500">{t('empty')}</p> : null}
					{result?.preview.truncated ? (
						<p className="mt-3 text-xs text-amber-700">{t('truncated', { count: result.preview.limit })}</p>
					) : null}
					{result && result.data.length > 0 ? (
						<div className="mt-4">
							<h3 className="mb-2 text-xs font-medium text-gray-500">{t('summary')}</h3>
							<div className="max-h-[70vh] overflow-auto">
								<table className="min-w-full text-left text-xs">
									<thead className="sticky top-0 bg-white text-gray-500">
										<tr>
											<th className="py-1 pr-3 font-medium">{t('model')}</th>
											<th className="py-1 pr-3 font-medium">{t('group')}</th>
											<th className="py-1 pr-3 font-medium">catalog</th>
											<th className="py-1 pr-3 font-medium">route</th>
											<th className="py-1 font-medium">composite</th>
										</tr>
									</thead>
									<tbody>
										{result.data.flatMap((item) =>
											Object.entries(item.model_info.discounts).map(([group, discount]) => (
												<tr key={`${item.id}:${group}`} className="border-t border-gray-100 font-mono text-gray-800">
													<td className="py-1.5 pr-3">{item.id}</td>
													<td className="py-1.5 pr-3">{group}</td>
													<td className="py-1.5 pr-3">{discount.current.catalog_factor}</td>
													<td className="py-1.5 pr-3">{discount.current.route_factor}</td>
													<td className="py-1.5">{discount.current.composite_factor}</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					) : null}
				</div>
				<div className="min-w-0">
					<h3 className="mb-2 text-xs font-medium text-gray-500">{t('response')}</h3>
					<pre className="max-h-[70vh] min-h-48 overflow-auto rounded-md bg-gray-950 p-3 text-[11px] leading-5 text-gray-100">
						{payload ? JSON.stringify(payload, null, 2) : ''}
					</pre>
				</div>
			</div>
		</section>
	);
}
