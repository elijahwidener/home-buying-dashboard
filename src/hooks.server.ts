import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { kickCommutes } from '#lib/server/commute.js';
import { startScheduler } from '#lib/server/refresh.js';

startScheduler();
// Finish any commute times left over from before a restart (the planner starts only if something is missing).
if (!process.env.NO_REFRESH) setTimeout(kickCommutes, 15_000).unref();

export const handle: Handle = async ({ event, resolve }) => {
	const { request } = event;
	const method = request.method;

	// CSRF: Kit's own origin check is disabled (it can't know whether we're reached over
	// http on the LAN or https via Tailscale), so compare hosts here instead.
	if (method !== 'GET' && method !== 'HEAD') {
		const origin = request.headers.get('origin');
		const host = request.headers.get('host');
		if (origin && host && new URL(origin).host !== host) {
			error(403, 'Cross-site request blocked');
		}
	}

	return resolve(event);
};
