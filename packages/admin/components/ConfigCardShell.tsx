import type { ReactNode } from 'react';

/** 左栏标题与说明，右栏控件与操作（大屏横向，小屏纵向堆叠）。 */
export function ConfigCardShell({
	title,
	description,
	children,
	id,
}: {
	title: string;
	description: ReactNode;
	children: ReactNode;
	id?: string;
}) {
	return (
		<div id={id} className="mb-6 scroll-mt-8 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
			<div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
				<div className="min-w-0 lg:w-[min(100%,22rem)] xl:w-96 shrink-0">
					<h2 className="text-lg font-semibold text-gray-900">{title}</h2>
					<div className="mt-2 text-sm text-gray-500 leading-relaxed">{description}</div>
				</div>
				<div className="min-w-0 flex-1 border-t border-gray-100 pt-6 lg:border-t-0 lg:border-l lg:border-gray-200 lg:pl-8 lg:pt-0">
					{children}
				</div>
			</div>
		</div>
	);
}
