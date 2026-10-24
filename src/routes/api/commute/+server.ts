// Live status for the commute computation and the trip planner (polled by the Areas and Settings pages).
import { json } from '@sveltejs/kit';
import { commuteProgress } from '#lib/server/commute.js';
import { plannerState } from '#lib/server/otp.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	const p = plannerState();
	return json({ progress: commuteProgress(), planner: { built: p.built, building: p.building, running: p.running, log: p.log.slice(-12) } });
};
