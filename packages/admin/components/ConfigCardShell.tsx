"use client";

import { useId, type ReactNode } from "react";
import { InfoHintPopover } from "./InfoHintPopover";
import {
	ClockIcon,
	CurrencyDollarIcon,
	ArrowsRightLeftIcon,
	ScaleIcon,
	BellIcon,
	ShieldCheckIcon,
	WrenchScrewdriverIcon,
	ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
const SECTION_ICONS = {
	"config-timezone": ClockIcon,
	"config-currency": CurrencyDollarIcon,
	"config-routing": ArrowsRightLeftIcon,
	"config-multipliers": ScaleIcon,
	"config-webhooks": BellIcon,
	"maintenance-status": ShieldCheckIcon,
	"maintenance-enable": WrenchScrewdriverIcon,
	"maintenance-messages": ChatBubbleLeftRightIcon,
};

/** Compact settings card with an optional explanation and independent save footer. */
export function ConfigCardShell({
	title,
	description,
	hint,
	children,
	footer,
	id,
}: {
	title: string;
	description: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	id?: string;
}) {
	const titleId = useId();
	const Icon = SECTION_ICONS[id as keyof typeof SECTION_ICONS];
	return (
		<section
			id={id}
			aria-labelledby={titleId}
			className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
		>
			<div className="mb-5">
				<div className="flex items-center gap-2">
					{Icon && (
						<Icon
							className="h-4 w-4 shrink-0 text-gray-400"
							aria-hidden="true"
						/>
					)}
					<h2 id={titleId} className="text-base font-medium text-gray-900">
						{title}
					</h2>
					{hint && (
						<InfoHintPopover label={title} portal openOnHover align="start">
							{hint}
						</InfoHintPopover>
					)}
				</div>
				<div className="mt-1 text-sm leading-relaxed text-gray-500">
					{description}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">{children}</div>
			{footer && (
				<div className="mt-5 border-t border-gray-100 pt-4">{footer}</div>
			)}
		</section>
	);
}
