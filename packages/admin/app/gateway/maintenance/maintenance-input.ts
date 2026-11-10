export function customMaintenanceMinutes(raw: string): number | null {
	if (!raw.trim()) return null;
	const n = Number(raw);
	return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
