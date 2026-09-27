import type { ProviderAccountIdentity } from '@/lib/provider-kind';

export function ProviderAccountLines(props: {
	identity: ProviderAccountIdentity;
	nameClassName?: string;
	/** 名称旁的小标记，例如已删除的供应商。 */
	badge?: string | null;
}) {
	const { identity, nameClassName = 'font-medium text-gray-900', badge } = props;
	const badgeLabel = badge?.trim() ?? '';
	return (
		<span className="block min-w-0 flex-1" title={identity.title}>
			<span className="flex min-w-0 items-center gap-1.5">
				<span className={`min-w-0 truncate ${nameClassName}`}>{identity.name}</span>
				{badgeLabel ? (
					<span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-gray-500">
						{badgeLabel}
					</span>
				) : null}
			</span>
			{identity.kind ? (
				<span className="mt-0.5 block truncate text-xs font-normal leading-4 text-slate-500">{identity.kind}</span>
			) : null}
		</span>
	);
}
