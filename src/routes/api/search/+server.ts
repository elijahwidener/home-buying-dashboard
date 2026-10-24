// Place search for new commute places and areas: OpenStreetMap's Nominatim (landmarks, addresses, neighborhoods).
// Only the typed search text is sent. Nominatim asks for at most one request a second, which typing into a search box with a button respects.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < 3) return json([]);
	const params = new URLSearchParams({
		q,
		format: 'jsonv2',
		limit: '6',
		countrycodes: 'us',
		// Prefer the DC region without excluding elsewhere.
		viewbox: '-77.6,39.4,-76.6,38.6',
		addressdetails: '0'
	});
	const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
		headers: { 'user-agent': 'home-dashboard/1.0 (personal use)', 'accept-language': 'en' },
		signal: AbortSignal.timeout(15_000)
	}).catch(() => null);
	if (!res?.ok) error(502, 'Place search is unavailable right now.');
	const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
	return json(rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) })));
};
