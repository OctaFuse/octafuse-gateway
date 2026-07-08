import { NextResponse } from 'next/server';
import { isLocale, LOCALE_COOKIE, type Locale } from '@/lib/locale';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
	let body: { locale?: string };
	try {
		body = (await request.json()) as { locale?: string };
	} catch {
		return NextResponse.json({ success: false, message: 'Invalid JSON' }, { status: 400 });
	}

	const locale = body.locale;
	if (!locale || !isLocale(locale)) {
		return NextResponse.json({ success: false, message: 'Invalid locale' }, { status: 400 });
	}

	const response = NextResponse.json({ success: true, locale: locale satisfies Locale });
	response.cookies.set(LOCALE_COOKIE, locale, {
		path: '/',
		sameSite: 'lax',
		maxAge: ONE_YEAR_SECONDS,
	});
	return response;
}
