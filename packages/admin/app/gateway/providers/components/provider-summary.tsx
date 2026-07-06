import type { ProviderOverview } from '../types';

type ProviderSummaryProps = {
	pendingKeyCount: number;
	overview: ProviderOverview;
};

export function ProviderSummary(props: ProviderSummaryProps) {
	const { pendingKeyCount, overview } = props;

	return (
		<>
			{pendingKeyCount > 0 && (
				<div
					className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
					role="status"
				>
					<strong>{pendingKeyCount}</strong> provider(s) still use the import placeholder API key. Click a row to
					edit and enter a real upstream key before routing traffic.
				</div>
			)}

			<div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">Providers</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{overview.total}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">Active Keys</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{overview.activeKeys}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">OpenAI</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{overview.protocols.openai}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">Anthropic</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-orange-700">{overview.protocols.anthropic}</div>
				</div>
				<div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
					<div className="text-xs font-medium uppercase tracking-wide text-gray-500">Gemini</div>
					<div className="mt-1 text-2xl font-semibold tabular-nums text-indigo-700">{overview.protocols.gemini}</div>
				</div>
			</div>

			{overview.withoutKeys > 0 && (
				<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="status">
					<strong>{overview.withoutKeys}</strong> provider(s) have no active upstream key.
				</div>
			)}
		</>
	);
}
