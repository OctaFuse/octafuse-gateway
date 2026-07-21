/** Cookie used by next-intl (without URL-based routing). */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const locales = ['en', 'zh', 'ja', 'ko'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export function isLocale(value: string): value is Locale {
	return (locales as readonly string[]).includes(value);
}

export function resolveLocale(cookieValue: string | undefined): Locale {
	if (cookieValue && isLocale(cookieValue)) {
		return cookieValue;
	}
	return defaultLocale;
}
