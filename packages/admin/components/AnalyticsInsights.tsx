"use client";

import {
	ArrowPathIcon,
	ShieldCheckIcon,
	BanknotesIcon,
	ScaleIcon,
	MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { AdminInspector } from "./admin-inspector";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
	summarizeAnalytics,
	type AnalyticsSummaryRow,
	type AnalyticsView,
} from "@/lib/analytics-insights";
import { formatGatewayMoneyCode } from "@/lib/format-gateway-currency";

export function AnalyticsInsights({
	rows,
	currency,
	scope,
}: {
	rows: readonly AnalyticsSummaryRow[];
	currency: string;
	scope: "models" | "providers" | "users" | "reliability";
}) {
	const t = useTranslations("analytics.insights");
	const s = summarizeAnalytics(rows);
	const money = (n: number) => formatGatewayMoneyCode(n, currency, 4);
	const columns = useTranslations("analytics.columns");
	const cards = [
		{
			label: t("requests"),
			value: s.requests.toLocaleString(),
			icon: ArrowPathIcon,
			tone: "bg-blue-50 text-blue-700",
			note: "",
		},
		{
			label: t("successRate"),
			value: s.successRate == null ? "—" : `${s.successRate.toFixed(1)}%`,
			icon: ShieldCheckIcon,
			tone:
				s.errors > 0
					? "bg-amber-50 text-amber-700"
					: "bg-emerald-50 text-emerald-700",
			note: `${t("errors")} ${s.errors.toLocaleString()}`,
		},
		{
			label: t("charged"),
			value: money(s.charged),
			icon: BanknotesIcon,
			tone: "bg-indigo-50 text-indigo-700",
			note: `${columns("standard")} ${money(s.standard)}`,
		},
		{
			label: t("margin"),
			value: money(s.margin),
			icon: ScaleIcon,
			tone:
				s.margin < 0 ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600",
			note: `${t("metered")} ${money(s.metered)}`,
		},
	];
	return (
		<section className="mb-5 space-y-3" aria-label={t("summary")}>
			<div className="admin-summary-canvas grid grid-cols-2 gap-3 xl:grid-cols-4">
				{cards.map(({ label, value, icon: Icon, tone, note }) => (
					<div
						key={label}
						className="admin-summary-metric min-w-0 rounded-xl border border-gray-200 bg-white p-4"
					>
						<p className="flex items-center gap-2 text-xs text-gray-500">
							<span
								className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}
								aria-hidden="true"
							>
								<Icon className="h-4 w-4" />
							</span>
							{label}
						</p>
						<p className="admin-summary-value mt-3 break-words font-mono text-xl font-medium tabular-nums text-gray-900">
							{value}
						</p>
						<p className="mt-2 min-h-4 text-xs tabular-nums text-gray-500">
							{note || t("summary")}
						</p>
					</div>
				))}
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
				<p>
					{t("outcomes", {
						success: Math.round(s.successes),
						errors: s.errors,
						other: Math.max(0, Math.round(s.requests - s.successes - s.errors)),
					})}
				</p>
				<AdminInspector label={t("definitions")}>
					<p className="text-sm leading-6 text-gray-600">
						{t("scope." + scope)}
					</p>
					<p className="text-sm leading-6 text-gray-600">
						{t("costNote", { standard: money(s.standard) })}
					</p>
					<p className="text-sm leading-6 text-gray-600">{t("qualityNote")}</p>
					{scope === "users" ? (
						<p className="text-sm leading-6 text-gray-600">{t("budgetNote")}</p>
					) : null}
				</AdminInspector>
			</div>
		</section>
	);
}

export function AnalyticsControls({
	search,
	onSearch,
	view,
	onView,
	users = false,
	count,
	children,
}: {
	search: string;
	onSearch: (value: string) => void;
	view: AnalyticsView;
	onView: (value: AnalyticsView) => void;
	users?: boolean;
	count: number;
	children?: ReactNode;
}) {
	const t = useTranslations("analytics.insights");
	const views: AnalyticsView[] = [
		"overview",
		"cost",
		users ? "budget" : "performance",
		"all",
	];
	return (
		<div className="admin-filter-surface mb-4 flex flex-wrap items-center gap-3">
			{children}
			<div className="relative w-full shrink-0 sm:min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
				<MagnifyingGlassIcon
					className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400"
					aria-hidden="true"
				/>
				<input
					type="search"
					aria-label={t("search")}
					placeholder={t("search")}
					value={search}
					onChange={(e) => onSearch(e.target.value)}
					className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm"
				/>
			</div>
			<div
				className="flex max-w-full flex-wrap gap-1 rounded-lg bg-gray-100 p-1"
				role="group"
				aria-label={t("view")}
			>
				{views.map((v) => (
					<button
						key={v}
						type="button"
						aria-pressed={v === view}
						onClick={() => onView(v)}
						className={`rounded-md px-3 py-1.5 text-xs ${
							v === view
								? "bg-white text-gray-950 shadow-sm"
								: "text-gray-500 hover:text-gray-900"
						}`}
					>
						{t("views." + v)}
					</button>
				))}
			</div>
			<span className="text-xs text-gray-500">{t("matching", { count })}</span>
		</div>
	);
}

export function AnalyticsLoadError({ onRetry }: { onRetry: () => void }) {
	const t = useTranslations("analytics.insights");
	return (
		<div
			role="alert"
			className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
		>
			<span>{t("loadError")}</span>
			<button type="button" className="shrink-0 underline" onClick={onRetry}>
				{t("retry")}
			</button>
		</div>
	);
}
