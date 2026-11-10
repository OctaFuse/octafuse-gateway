"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS, matchAdminNavRoute } from "@/lib/admin-nav";
import { ADMIN_NAV_ICONS } from "./layout/admin-nav-icons";

const TONES = {
	overview: "bg-blue-50 text-blue-700",
	inference: "bg-blue-50 text-blue-700",
	user: "bg-emerald-50 text-emerald-700",
	tools: "bg-teal-50 text-teal-700",
	analytics: "bg-indigo-50 text-indigo-700",
	integration: "bg-amber-50 text-amber-700",
	system: "bg-slate-100 text-slate-600",
};
/** A shared title scale and a small category marker, including on mobile. */
export function AdminPageTitle({ children }: { children: ReactNode }) {
	const route = matchAdminNavRoute(usePathname());
	const group = ADMIN_NAV_GROUPS.find((g) =>
		g.items.some((i) => i.href === route?.href)
	);
	const Icon = route ? ADMIN_NAV_ICONS[route.nameKey] : null;
	return (
		<h1 className="flex min-w-0 items-center gap-3 text-2xl font-medium leading-8 text-gray-900 sm:text-[28px] sm:leading-9">
			{Icon && (
				<span
					aria-hidden="true"
					className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
						TONES[group?.groupKey ?? "system"]
					}`}
				>
					<Icon className="h-5 w-5" />
				</span>
			)}
			<span className="min-w-0 break-words [overflow-wrap:anywhere]">
				{children}
			</span>
		</h1>
	);
}
