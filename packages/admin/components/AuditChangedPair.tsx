'use client';

/**
 * 审计表前后值：未变化只显示当前值，变化时 before → after 高亮。
 */
export const auditChangedHighlight = {
	before: 'rounded px-0.5 bg-amber-50 text-amber-900',
	after: 'rounded px-0.5 bg-sky-50 text-sky-900',
} as const;

export function AuditChangedPair({
	changed,
	before,
	after,
}: {
	changed: boolean;
	before: string;
	after: string;
}) {
	if (!changed) {
		return <>{after}</>;
	}
	return (
		<>
			<span className={auditChangedHighlight.before}>{before}</span>
			<span className="text-gray-400"> → </span>
			<span className={auditChangedHighlight.after}>{after}</span>
		</>
	);
}
