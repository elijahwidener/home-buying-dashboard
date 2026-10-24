// Zillow Research public CSVs: home values, rents and forecasts by zip; inventory and
// price cuts for the DC metro. Files are large, so each is streamed and only the rows
// for tracked zips are kept. A HEAD request skips files that haven't changed.
import { allZips, type Config } from '#lib/config.js';
import { putSeries, run, type Point } from '#lib/server/db.js';
import { csvSplit, fetchOk, job, lastModified, lines } from './common.ts';

const BASE = 'https://files.zillowstatic.com/research/public_csvs';
export const METRO = 'Washington, DC';

interface Dataset {
	key: string;
	label: string;
	path: string;
	level: 'zip' | 'metro';
	/** Forecast files: replace the series instead of appending. */
	replace?: boolean;
}

export const ZILLOW: Dataset[] = [
	{ key: 'zhvi_all', label: 'Typical home value (all homes)', path: 'zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv', level: 'zip' },
	{ key: 'zhvi_2bd', label: 'Typical 2-bed value', path: 'zhvi/Zip_zhvi_bdrmcnt_2_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv', level: 'zip' },
	{ key: 'zhvi_sfr', label: 'Typical single-family value', path: 'zhvi/Zip_zhvi_uc_sfr_tier_0.33_0.67_sm_sa_month.csv', level: 'zip' },
	{ key: 'zhvi_condo', label: 'Typical condo value', path: 'zhvi/Zip_zhvi_uc_condo_tier_0.33_0.67_sm_sa_month.csv', level: 'zip' },
	{ key: 'zori', label: 'Typical rent', path: 'zori/Zip_zori_uc_sfrcondomfr_sm_month.csv', level: 'zip' },
	{ key: 'zhvf', label: 'Value forecast (% change)', path: 'zhvf_growth/Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv', level: 'zip', replace: true },
	{ key: 'invt', label: 'DC metro for-sale inventory', path: 'invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv', level: 'metro' },
	{ key: 'doz', label: 'DC metro median days to pending', path: 'med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv', level: 'metro' },
	{ key: 'cuts', label: 'DC metro share of listings with a price cut', path: 'perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv', level: 'metro' },
	{ key: 'mlp', label: 'DC metro median list price', path: 'mlp/Metro_mlp_uc_sfrcondo_sm_month.csv', level: 'metro' }
];

export const zillowId = (key: string, region: string) => `zillow:${key}:${region}`;

export async function refreshZillow(cfg: Config, force = false) {
	const zips = allZips(cfg);
	for (const ds of ZILLOW) {
		await job(`zillow:${ds.key}`, `Zillow · ${ds.label}`, async (prev) => {
			const url = `${BASE}/${ds.path}`;
			const lm = await lastModified(url);
			// Re-download when the file changed, or when the zip list did.
			const stamp = `${lm}|${ds.level === 'zip' ? zips.join(',') : METRO}`;
			if (!force && prev?.status === 'ok' && prev.last_modified === stamp) {
				return { message: prev.message, changed: false };
			}
			const res = await fetchOk(url, {}, 15 * 60_000);
			let header: string[] | null = null;
			let regionCol = -1;
			let dateCols: [number, string][] = [];
			let found = 0;
			const want = ds.level === 'zip' ? new Set(zips) : new Set([METRO]);
			// Cheap pre-filter so only candidate lines get fully parsed.
			const needles = [...want];
			for await (const line of lines(res)) {
				if (!header) {
					header = csvSplit(line);
					regionCol = header.indexOf('RegionName');
					dateCols = header.map((h, i) => [i, h] as [number, string]).filter(([, h]) => /^\d{4}-\d{2}-\d{2}$/.test(h));
					if (regionCol < 0 || !dateCols.length) throw new Error('unexpected file layout');
					continue;
				}
				if (!needles.some((n) => line.includes(n))) continue;
				const cells = csvSplit(line);
				const region = cells[regionCol];
				if (!want.has(region)) continue;
				const points: Point[] = [];
				for (const [i, date] of dateCols) {
					const v = Number(cells[i]);
					if (cells[i] !== '' && Number.isFinite(v)) points.push({ date, value: v });
				}
				const id = zillowId(ds.key, ds.level === 'zip' ? region : 'metro');
				if (ds.replace) run('DELETE FROM series WHERE series_id = ?', id);
				putSeries(id, points);
				found++;
			}
			const missing = ds.level === 'zip' ? zips.length - found : 1 - found;
			return {
				message: `${found} region${found === 1 ? '' : 's'} updated${missing > 0 ? `, ${missing} not covered` : ''}`,
				lastModified: stamp
			};
		});
	}
}
