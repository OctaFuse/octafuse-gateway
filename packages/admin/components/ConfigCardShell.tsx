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
			<div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:gap-10">
				<div className="min-w-0 xl:w-80 2xl:w-96 shrink-0">
					<h2 className="text-lg font-semibold text-gray-900">{title}</h2>
					<div className="mt-2 text-sm text-gray-500 leading-relaxed [overflow-wrap:anywhere]">{description}</div>
				</div>
				<div className="min-w-0 flex-1 border-t border-gray-100 pt-6 xl:border-t-0 xl:border-l xl:border-gray-200 xl:pl-8 xl:pt-0">
					{children}
				</div>
			</div>
		</div>
	);
}
