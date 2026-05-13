import { roundGatewayMoney } from '../lib/money-precision';

export function parseMoney(value: string | number | null | undefined): number {
	if (value == null) return 0;
	const num = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(num)) return 0;
	return roundGatewayMoney(num);
}

export function nowIso(): string {
	return new Date().toISOString();
}
