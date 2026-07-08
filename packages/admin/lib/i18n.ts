import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale } from '@/lib/locale';

export { defaultLocale, locales, type Locale } from '@/lib/locale';

export default getRequestConfig(async () => {
	const store = await cookies();
	const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);

	return {
		locale,
		messages: (await import(`@/messages/${locale}.json`)).default,
		timeZone: 'UTC',
		now: new Date(),
	};
});
