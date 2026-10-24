import { allZips } from '#lib/config.js';
import { loadConfig, series } from '#lib/server/db.js';
import { metroMarket, zipMarket } from '#lib/server/live.js';
import { zillowId } from '#lib/server/sources/zillow.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const cfg = loadConfig();
	const zips = allZips(cfg);
	const zip = zips.includes(url.searchParams.get('zip') ?? '') ? url.searchParams.get('zip')! : zips[0];
	const since = '2018-01-01';
	const names = Object.fromEntries(zips.map((z) => [z, cfg.areas.find((a) => a.zip === z)?.name ?? z]));

	return {
		zips,
		names,
		zip,
		summary: zips.map((z) => zipMarket(z)),
		values: {
			all: series(zillowId('zhvi_all', zip), since),
			bd2: series(zillowId('zhvi_2bd', zip), since),
			sfr: series(zillowId('zhvi_sfr', zip), since),
			condo: series(zillowId('zhvi_condo', zip), since),
			rent: series(zillowId('zori', zip), since),
			forecast: series(zillowId('zhvf', zip))
		},
		metro: {
			now: metroMarket(),
			inventory: series(zillowId('invt', 'metro'), since),
			days: series(zillowId('doz', 'metro'), since),
			cuts: series(zillowId('cuts', 'metro'), since)
		},
		rates: {
			m30: series('fred:MORTGAGE30US', '2014-01-01'),
			m15: series('fred:MORTGAGE15US', '2014-01-01')
		}
	};
};
