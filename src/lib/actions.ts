// Post to a SvelteKit form action from code (no <form>), e.g. to save as you click.
import { deserialize } from '$app/forms';

/** Returns null on success, or an error message. */
export async function postAction(action: string, fields: Record<string, string | number>): Promise<string | null> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
	try {
		const res = await fetch(action, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'failure') return String((result.data as { error?: string } | undefined)?.error ?? 'Not saved.');
		if (result.type === 'error') return 'Not saved: server error.';
		return null;
	} catch {
		return 'Not saved: is the server up?';
	}
}

/** Saves which areas are Compare columns (the Areas page action), from any page. */
export async function saveCompare(ids: Iterable<string>): Promise<boolean> {
	return (await postAction('/areas?/compare', { ids: [...ids].join(',') })) == null;
}
