'use client';

type Props = {
	label: string;
	method?: string;
	url: string | null | undefined;
	emptyHint?: string;
};

/** Request body 上方：展示将要 / 实际发出的完整 URL，便于排查路径拼接问题。 */
export function RequestTargetUrl(props: Props) {
	const { label, method = 'POST', url, emptyHint } = props;
	const hasUrl = typeof url === 'string' && url.trim() !== '';

	return (
		<div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
			<div className="text-xs font-medium normal-case tracking-normal text-slate-500">{label}</div>
			{hasUrl ? (
				<p className="mt-1 break-all font-mono text-xs leading-relaxed text-slate-900">
					<span className="font-medium text-slate-700">{method}</span>{' '}
					{url}
				</p>
			) : (
				<p className="mt-1 text-xs text-slate-400">{emptyHint ?? '—'}</p>
			)}
		</div>
	);
}
