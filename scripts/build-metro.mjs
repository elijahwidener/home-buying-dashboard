// Builds src/lib/metro.json (Metro lines and stations, simplified) from DC GIS GeoJSON.
// Source: maps2.dcgis.dc.gov .../Transportation_Rail_Bus_WebMercator/MapServer layers 51 (stations) and 58 (lines),
// saved in scripts/data/. Usage: node scripts/build-metro.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const S = JSON.parse(readFileSync('scripts/data/stations.json', 'utf8')).features;
const L = JSON.parse(readFileSync('scripts/data/lines.json', 'utf8')).features;

/** Douglas–Peucker in degrees; tolerance ~10 m keeps the curves. */
function simplify(pts, tol = 0.0001) {
	if (pts.length < 3) return pts;
	const [a, b] = [pts[0], pts.at(-1)];
	let max = 0, idx = 0;
	for (let i = 1; i < pts.length - 1; i++) {
		const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
		const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(dx, dy) || 1);
		if (d > max) [max, idx] = [d, i];
	}
	if (max <= tol) return [a, b];
	return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

const COLORS = { red: '#e51636', orange: '#f7941d', blue: '#0076c0', silver: '#a1a2a1', green: '#00a94f', yellow: '#ffd200' };

const r5 = (n) => Math.round(n * 1e5) / 1e5;

const lines = L.map((f) => {
	const name = f.properties.NAME;
	return { name, color: COLORS[name], coords: simplify(f.geometry.coordinates).map(([x, y]) => [r5(y), r5(x)]) };
});

const stations = S.map((f) => {
	const p = f.geometry.coordinates;
	return { name: f.properties.NAME, lines: f.properties.LINE.split(/[ ,]+/).filter((n) => COLORS[n]), lat: r5(p[1]), lng: r5(p[0]) };
});

const out = { source: 'DC GIS Metro Stations/Lines (Regional), WMATA', lines, stations };
writeFileSync('src/lib/metro.json', JSON.stringify(out));
console.log(`${stations.length} stations, ${lines.map((l) => `${l.name} ${l.coords.length}`).join(', ')} points`);
