"use client";

import { ClipboardDocumentIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatProviderEndpointsPreview } from "../provider-utils";
import type { ProviderFormData } from "../types";

export function ProviderEndpointsJsonPreview({
	form,
}: {
	form: ProviderFormData;
}) {
	const t = useTranslations("providers.modal");
	const tCommon = useTranslations("common");
	const hintId = useId();
	const textRef = useRef<HTMLTextAreaElement>(null);
	const json = useMemo(() => formatProviderEndpointsPreview(form), [form]);
	const [copyResult, setCopyResult] = useState<{
		json: string;
		state: "copied" | "failed";
	} | null>(null);
	const copyState = copyResult?.json === json ? copyResult.state : "idle";

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(json);
			setCopyResult({ json, state: "copied" });
		} catch {
			textRef.current?.focus();
			textRef.current?.select();
			setCopyResult({ json, state: "failed" });
		}
	};

	return (
		<div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
			<div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gray-50/70 px-4 py-3">
				<div>
					<h3 className="text-sm font-semibold text-gray-800">
						{t("jsonConfigTitle")}
					</h3>
					<p id={hintId} className="mt-1 text-xs leading-5 text-gray-500">
						{t("jsonConfigHint")}
					</p>
				</div>
				<button
					type="button"
					onClick={() => void copy()}
					className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					{copyState === "copied" ? (
						<CheckIcon className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
					) : (
						<ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />
					)}
					{copyState === "copied" ? tCommon("copied") : tCommon("copy")}
				</button>
			</div>
			{copyState === "failed" ? (
				<p role="status" className="px-4 pt-3 text-xs text-amber-700">
					{t("jsonCopyFailed")}
				</p>
			) : null}
			<textarea
				ref={textRef}
				readOnly
				spellCheck={false}
				aria-label={t("jsonConfigTitle")}
				aria-describedby={hintId}
				value={json}
				rows={18}
				className="block min-h-64 w-full resize-none border-0 bg-gray-50/40 p-4 font-mono text-xs leading-6 text-gray-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-200"
			/>
		</div>
	);
}
