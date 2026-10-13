'use client';
import { useTranslations } from 'next-intl';
import type { ServerForm } from '../mcp-types';
const INPUT =
	'mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 read-only:bg-gray-50 read-only:text-gray-500';
export function McpAdvancedSettings({
	form,
	onChange,
}: {
	form: ServerForm;
	onChange: (form: ServerForm) => void;
}) {
	const t = useTranslations('mcp');
	return (
		<section className="space-y-5">
			<div>
				<h3 className="text-sm font-semibold text-gray-900">{t('formTabs.advanced')}</h3>
				<p className="mt-1 text-xs leading-5 text-gray-500">{t('advancedHint')}</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<label className="text-sm text-gray-700">
					{t('timeout')}
					<input
						type="number"
						required
						min={1000}
						max={120000}
						step={1}
						value={form.timeoutMs}
						onChange={(e) => onChange({ ...form, timeoutMs: e.target.value })}
						className={INPUT}
					/>
					<span className="mt-1 block text-xs text-gray-400">{t('timeoutHint')}</span>
				</label>
				<label className="text-sm text-gray-700">
					{t('maxBytes')}
					<input
						type="number"
						required
						min={1000}
						max={8000000}
						step={1}
						value={form.maxResponseBytes}
						onChange={(e) => onChange({ ...form, maxResponseBytes: e.target.value })}
						className={INPUT}
					/>
					<span className="mt-1 block text-xs text-gray-400">{t('maxBytesHint')}</span>
				</label>
			</div>
		</section>
	);
}
