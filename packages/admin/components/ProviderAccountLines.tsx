import type { ProviderAccountIdentity } from '@/lib/provider-kind';

export function ProviderAccountLines(props: {
	identity: ProviderAccountIdentity;
	nameClassName?: string;
}) {
	const { identity, nameClassName = 'font-medium text-gray-900' } = props;
	return (
		<span className="block min-w-0 flex-1" title={identity.title}>
			<span className={`block truncate ${nameClassName}`}>{identity.name}</span>
			{identity.kind ? (
				<span className="mt-0.5 block truncate text-xs font-normal leading-4 text-slate-500">{identity.kind}</span>
			) : null}
		</span>
	);
}
