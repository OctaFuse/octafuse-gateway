'use client';

import { useState } from 'react';
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';

type Props = {
	secret: string;
	onDismiss: () => void;
};

/**
 * One-time full `sk-…` secret display after POST create key (matches User detail keys section).
 */
export function NewApiKeySecretBanner({ secret, onDismiss }: Props) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(secret);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 2000);
		} catch {
			/* ignore */
		}
	};

	return (
		<div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
			<div className="flex items-start justify-between gap-2">
				<p className="text-amber-900 pr-2">
					New API key — copy it now; the full secret will not be shown again.
				</p>
				<button
					type="button"
					onClick={onDismiss}
					className="shrink-0 text-amber-800 hover:underline text-xs"
				>
					Dismiss
				</button>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-2">
				<code className="min-w-0 flex-1 break-all rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-xs">
					{secret}
				</code>
				<button
					type="button"
					onClick={copy}
					className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-amber-100"
				>
					<ClipboardDocumentIcon className="h-3.5 w-3.5" />
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	);
}
