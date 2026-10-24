import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AREA_TEMPLATE, DEFAULT_CONFIG, mergeConfig, type Config } from '#lib/config.js';
import { seedDemo } from './demo.js';

const DATA_DIR = process.env.DATA_DIR ?? './data';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

-- Time series from live sources, e.g. fred:MORTGAGE30US or zillow:zhvi_2bd:20910.
CREATE TABLE IF NOT EXISTS series (
	series_id TEXT NOT NULL,
	date TEXT NOT NULL,                 -- YYYY-MM-DD
	value REAL NOT NULL,
	PRIMARY KEY (series_id, date)
);

-- One row per fetch job: when it last ran and how it went.
CREATE TABLE IF NOT EXISTS sources (
	key TEXT PRIMARY KEY,
	label TEXT NOT NULL,
	last_modified TEXT,                 -- upstream Last-Modified, to skip unchanged downloads
	checked_at TEXT,
	updated_at TEXT,
	status TEXT NOT NULL DEFAULT 'pending', -- ok | error | pending
	message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS news (
	link TEXT PRIMARY KEY,
	feed TEXT NOT NULL,
	title TEXT NOT NULL,
	source TEXT NOT NULL DEFAULT '',
	published TEXT NOT NULL,            -- ISO timestamp
	seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listings (
	id INTEGER PRIMARY KEY,
	address TEXT NOT NULL,
	city TEXT NOT NULL DEFAULT '',
	state TEXT NOT NULL DEFAULT '',
	zip TEXT NOT NULL DEFAULT '',
	url TEXT NOT NULL DEFAULT '',
	mls TEXT NOT NULL DEFAULT '',
	price REAL NOT NULL,
	beds REAL,
	baths REAL,
	sqft REAL,
	hoa REAL NOT NULL DEFAULT 0,        -- monthly
	tax_annual REAL,                    -- known yearly property tax, overrides the estimate
	property_type TEXT NOT NULL DEFAULT '',
	home_type TEXT NOT NULL DEFAULT 'house', -- house | townhouse | condo
	year_built INTEGER,
	dom INTEGER,                        -- days on market at last import
	status TEXT NOT NULL DEFAULT 'Active',
	jurisdiction TEXT NOT NULL DEFAULT '',
	stage TEXT NOT NULL DEFAULT 'watching', -- watching | toured | offer | passed
	starred INTEGER NOT NULL DEFAULT 0,
	notes TEXT NOT NULL DEFAULT '',
	source TEXT NOT NULL DEFAULT 'manual',
	first_seen TEXT NOT NULL DEFAULT (date('now', 'localtime')),
	updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS listing_prices (
	listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
	date TEXT NOT NULL,
	price REAL NOT NULL,
	PRIMARY KEY (listing_id, date)
);

CREATE TABLE IF NOT EXISTS savings (
	id INTEGER PRIMARY KEY,
	date TEXT NOT NULL,                 -- YYYY-MM-DD
	balance REAL NOT NULL,              -- total saved toward the house on that date
	note TEXT NOT NULL DEFAULT ''
);

-- Commute endpoints (work, or "what if I worked at..."); times come from the local trip planner.
CREATE TABLE IF NOT EXISTS commute_places (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	lat REAL NOT NULL,
	lng REAL NOT NULL,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Door-to-door minutes from an area's center to a place, by mode (transit | parkride | drive). NULL minutes = no route found.
CREATE TABLE IF NOT EXISTS commute_times (
	place_id INTEGER NOT NULL REFERENCES commute_places(id) ON DELETE CASCADE,
	area_id TEXT NOT NULL,
	lat REAL NOT NULL,                  -- where it was computed from (recomputed if the area moves)
	lng REAL NOT NULL,
	mode TEXT NOT NULL,
	minutes REAL,
	PRIMARY KEY (place_id, area_id, mode)
);

-- The same over a grid covering the region, for the map's commute bands.
-- data = JSON array of minutes (row-major from the north-west corner), null = no route.
CREATE TABLE IF NOT EXISTS commute_grids (
	place_id INTEGER NOT NULL REFERENCES commute_places(id) ON DELETE CASCADE,
	mode TEXT NOT NULL,
	south REAL NOT NULL, west REAL NOT NULL, north REAL NOT NULL, east REAL NOT NULL,
	rows INTEGER NOT NULL, cols INTEGER NOT NULL,
	data TEXT NOT NULL,
	computed_at TEXT NOT NULL DEFAULT (datetime('now')),
	PRIMARY KEY (place_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news(published);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_key ON listings(url) WHERE url != '';
`;

let instance: DatabaseSync | undefined;

export function db(): DatabaseSync {
	if (!instance) {
		mkdirSync(DATA_DIR, { recursive: true });
		instance = new DatabaseSync(join(DATA_DIR, 'homebuy.db'));
		instance.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
		instance.exec(SCHEMA);
		// Columns added after the first release.
		const cols = new Set((instance.prepare('PRAGMA table_info(listings)').all() as { name: string }[]).map((c) => c.name));
		if (!cols.has('lat')) instance.exec('ALTER TABLE listings ADD COLUMN lat REAL; ALTER TABLE listings ADD COLUMN lng REAL;');
		// '' = not looked up yet | ok | none (the geocoder couldn't place it)
		if (!cols.has('geo_status')) instance.exec("ALTER TABLE listings ADD COLUMN geo_status TEXT NOT NULL DEFAULT ''");
		// Where the planner actually routes to: the place moved onto a public street if it sits inside closed grounds.
		const pcols = new Set((instance.prepare('PRAGMA table_info(commute_places)').all() as { name: string }[]).map((c) => c.name));
		if (!pcols.has('rlat')) instance.exec('ALTER TABLE commute_places ADD COLUMN rlat REAL; ALTER TABLE commute_places ADD COLUMN rlng REAL;');
		// The default commute place, matching config.commute.placeId = 1.
		instance.exec("INSERT OR IGNORE INTO commute_places (id, name, lat, lng) VALUES (1, 'Metro Center', 38.8983, -77.0281)");
		// Sample listings and savings for a brand-new database (once; DEMO_DATA=0 skips them).
		if (!instance.prepare("SELECT 1 FROM settings WHERE key = 'demo_seeded'").get()) {
			const fresh = !instance.prepare('SELECT 1 FROM settings UNION ALL SELECT 1 FROM listings UNION ALL SELECT 1 FROM savings').get();
			if (fresh && process.env.DEMO_DATA !== '0') seedDemo(instance);
			instance.exec("INSERT INTO settings (key, value) VALUES ('demo_seeded', '1')");
		}
	}
	return instance;
}

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
	return db().prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
	return db().prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
	return db().prepare(sql).run(...params);
}

export function tx(fn: () => void) {
	db().exec('BEGIN');
	try {
		fn();
		db().exec('COMMIT');
	} catch (e) {
		db().exec('ROLLBACK');
		throw e;
	}
}

export function getSetting(key: string): string | undefined {
	return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value;
}

export function setSetting(key: string, value: string) {
	run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

export function loadConfig(): Config {
	const raw = getSetting('config');
	if (!raw) return structuredClone(DEFAULT_CONFIG);
	let cfg: Config;
	try {
		cfg = mergeConfig(structuredClone(DEFAULT_CONFIG), JSON.parse(raw));
	} catch {
		return structuredClone(DEFAULT_CONFIG);
	}
	// Saved areas and jurisdictions replace the defaults whole, so fill in fields added since they were saved.
	cfg.areas = cfg.areas.map((a) => ({ ...AREA_TEMPLATE, ...a }));
	for (const [id, j] of Object.entries(cfg.jurisdictions)) {
		const base = DEFAULT_CONFIG.jurisdictions[id] ?? { crimeAvg: null, crimeAvg2026: null };
		cfg.jurisdictions[id] = { ...base, ...j } as Config['jurisdictions'][string];
	}
	return cfg;
}

export function saveConfig(cfg: Config) {
	setSetting('config', JSON.stringify(cfg));
}

export interface Point {
	date: string;
	value: number;
}

export function series(id: string, since = '0000'): Point[] {
	return all<Point>('SELECT date, value FROM series WHERE series_id = ? AND date >= ? ORDER BY date', id, since);
}

export function latest(id: string): Point | undefined {
	return get<Point>('SELECT date, value FROM series WHERE series_id = ? ORDER BY date DESC LIMIT 1', id);
}

/** Value on or before a date. */
export function valueAt(id: string, date: string): Point | undefined {
	return get<Point>('SELECT date, value FROM series WHERE series_id = ? AND date <= ? ORDER BY date DESC LIMIT 1', id, date);
}

export function putSeries(id: string, points: Point[]) {
	const stmt = db().prepare('INSERT INTO series (series_id, date, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = excluded.value');
	tx(() => {
		for (const p of points) stmt.run(id, p.date, p.value);
	});
}

/** Latest savings balance: the newest log entry, else the starting balance from settings. */
export function currentSavings(cfg: Config): { balance: number; date: string } {
	const row = get<{ balance: number; date: string }>('SELECT balance, date FROM savings ORDER BY date DESC, id DESC LIMIT 1');
	return row ?? { balance: cfg.profile.savings, date: new Date().toLocaleDateString('en-CA') };
}
