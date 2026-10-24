// Map points for listings that didn't come with one (Redfin CSVs include coordinates; hand-added listings don't).
// US Census geocoder: free, no key. Only the street address is sent.
import { all, run } from '#lib/server/db.js';
import { fetchOk, job } from './common.ts';

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

export async function refreshGeocode() {
	await job('geocode', 'Listing map points (US Census geocoder)', async () => {
		const todo = all<{ id: number; address: string; city: string; state: string; zip: string }>(
			"SELECT id, address, city, state, zip FROM listings WHERE lat IS NULL AND geo_status = '' LIMIT 50"
		);
		let found = 0;
		for (const l of todo) {
			const q = [l.address, l.city, [l.state, l.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
			const res = await fetchOk(`${CENSUS}?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`, {}, 20_000);
			const body = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } };
			const hit = body.result?.addressMatches?.[0]?.coordinates;
			if (hit) {
				run("UPDATE listings SET lat = ?, lng = ?, geo_status = 'ok' WHERE id = ?", hit.y, hit.x, l.id);
				found++;
			} else {
				run("UPDATE listings SET geo_status = 'none' WHERE id = ?", l.id);
			}
		}
		return { message: todo.length ? `placed ${found} of ${todo.length}` : 'nothing to place', changed: found > 0 };
	});
}
