// Rates and macro data from FRED's public CSV endpoint (no API key needed).
import { putSeries, type Point } from '#lib/server/db.js';
import { csvParse, fetchOk, job } from './common.ts';

export const FRED_SERIES: Record<string, string> = {
	MORTGAGE30US: '30-yr fixed (Freddie Mac weekly avg)',
	MORTGAGE15US: '15-yr fixed (Freddie Mac weekly avg)',
	DGS10: '10-yr Treasury yield',
	DFEDTARU: 'Fed funds target (upper)',
	CPIAUCSL: 'CPI (all items)'
};

export async function refreshFred() {
	for (const [id, label] of Object.entries(FRED_SERIES)) {
		await job(`fred:${id}`, `FRED · ${label}`, async () => {
			const res = await fetchOk(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=2014-01-01`);
			const rows = csvParse(await res.text()).slice(1);
			const points: Point[] = [];
			for (const [date, v] of rows) {
				const value = Number(v);
				if (/^\d{4}-\d{2}-\d{2}$/.test(date) && v !== '.' && Number.isFinite(value)) points.push({ date, value });
			}
			if (!points.length) throw new Error('no data rows');
			putSeries(`fred:${id}`, points);
			const last = points[points.length - 1];
			return { message: `${points.length} points, latest ${last.date} = ${last.value}`, lastModified: res.headers.get('last-modified') };
		});
	}
}
