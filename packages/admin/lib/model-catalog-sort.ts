/** Admin list/card ordering for gateway catalog models. */

type ModelReleasedAtFields = {
	released_at?: string | null;
	display_name?: string | null;
	id: string;
};

/**
 * Sort models newest-first by `released_at` (YYYY-MM-DD).
 * Models without a release date sort after dated models; tie-break on display name then id.
 */
export function compareModelsByReleasedAtDesc(a: ModelReleasedAtFields, b: ModelReleasedAtFields): number {
	const da = a.released_at?.trim() ?? '';
	const db = b.released_at?.trim() ?? '';
	if (da && db) {
		const dateCmp = db.localeCompare(da);
		if (dateCmp !== 0) return dateCmp;
	} else if (da !== db) {
		return da ? -1 : 1;
	}
	const nameA = a.display_name || a.id;
	const nameB = b.display_name || b.id;
	const nameCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
	if (nameCmp !== 0) return nameCmp;
	return a.id.localeCompare(b.id, undefined, { sensitivity: 'base' });
}
