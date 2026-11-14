'use client';

import { useEffect, useState } from 'react';
import { highlightCode, type CodeLanguage, type CodeToken } from '@/lib/code-highlight';
import styles from './highlighted-code.module.css';

export function HighlightedCode({ code, language, label }: { code: string; language: CodeLanguage; label: string }) {
	const [highlight, setHighlight] = useState<{ code: string; language: CodeLanguage; tokens: CodeToken[] } | null>(
		null
	);
	useEffect(() => {
		let active = true;
		void highlightCode(code, language).then(
			(tokens) => {
				if (active) setHighlight({ code, language, tokens });
			},
			() => {
				/* Keep the original code readable if highlighting is unavailable. */
			}
		);
		return () => {
			active = false;
		};
	}, [code, language]);
	const tokens = highlight?.code === code && highlight.language === language ? highlight.tokens : null;
	return (
		<pre className={styles.block} tabIndex={0} role="region" aria-label={label}>
			<code className={`language-${language}`}>
				{tokens
					? tokens.map((token, index) =>
							token.kind ? (
								<span key={index} className={styles[token.kind]}>
									{token.text}
								</span>
							) : (
								token.text
							)
					  )
					: code}
			</code>
		</pre>
	);
}
