import { tokenize, type ShjToken } from '@speed-highlight/core';

export type CodeLanguage = 'json' | 'bash' | 'ts';
export type CodeToken = { text: string; kind?: ShjToken };

/** Return text tokens rather than HTML so React owns escaping and rendering. */
export async function highlightCode(code: string, language: CodeLanguage): Promise<CodeToken[]> {
	const tokens: CodeToken[] = [];
	await tokenize(code, language, (text, kind) => tokens.push({ text, kind }));
	return tokens;
}
