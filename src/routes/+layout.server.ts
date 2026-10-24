import { get } from '#lib/server/db.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const s = get<{ checked: string | null; errors: number }>(
		"SELECT MAX(checked_at) AS checked, SUM(status = 'error') AS errors FROM sources"
	);
	return { checked: s?.checked ?? null, sourceErrors: s?.errors ?? 0 };
};
