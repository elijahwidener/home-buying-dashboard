import type { DatabaseSync } from 'node:sqlite';

// Sample listings and savings history, added once to a brand-new database so every page has something to show.
// The addresses are made up. Settings → Backup & reset → "Remove sample data" deletes them; DEMO_DATA=0 skips them.

type Demo = [address: string, city: string, state: string, zip: string, price: number, wasPrice: number | null, beds: number, baths: number,
	sqft: number, hoa: number, homeType: string, yearBuilt: number, dom: number, jurisdiction: string, stage: string, starred: number,
	lat: number, lng: number, notes: string];

const LISTINGS: Demo[] = [
	['1234 Sample St NW', 'Washington', 'DC', '20011', 749000, 775000, 3, 2.5, 1650, 0, 'townhouse', 1925, 41, 'dc', 'toured', 1, 38.9445, -77.026, 'Sample listing. Renovated kitchen, unfinished basement.'],
	['456 Example Ave NE', 'Washington', 'DC', '20017', 679000, null, 3, 2, 1500, 0, 'house', 1941, 12, 'dc', 'watching', 0, 38.9325, -76.9925, 'Sample listing.'],
	['789 Demo Way #512', 'Silver Spring', 'MD', '20910', 339000, null, 2, 2, 1050, 410, 'condo', 2004, 8, 'moco', 'watching', 0, 38.9955, -77.029, 'Sample listing. Garage parking included.'],
	['22 Placeholder Ct', 'Rockville', 'MD', '20850', 565000, null, 3, 3.5, 1800, 95, 'townhouse', 1998, 20, 'rockville', 'watching', 1, 39.0855, -77.149, 'Sample listing.'],
	['1010 Fictional Rd', 'Hyattsville', 'MD', '20782', 489000, 515000, 3, 2, 1400, 0, 'house', 1950, 55, 'pg', 'watching', 0, 38.957, -76.948, 'Sample listing. Two price cuts so far.'],
	['3300 Mock Blvd #1104', 'Arlington', 'VA', '22203', 459000, null, 2, 2, 1100, 560, 'condo', 2008, 15, 'arlington', 'watching', 0, 38.883, -77.112, 'Sample listing.'],
	['8 Test Ln', 'Springfield', 'VA', '22150', 645000, null, 4, 3, 2100, 0, 'house', 1967, 30, 'fairfax', 'passed', 0, 38.79, -77.185, 'Sample listing. Passed: needs a new roof.']
];

/** Monthly house-fund balances, oldest first, ending at the default starting savings. */
const SAVINGS = [45000, 48000, 51000, 54000, 57000, 60000];

export const DEMO_SOURCE = 'demo';
export const DEMO_NOTE = 'Sample entry';

export function seedDemo(db: DatabaseSync) {
	const listing = db.prepare(
		`INSERT INTO listings (address, city, state, zip, price, beds, baths, sqft, hoa, home_type, year_built, dom, jurisdiction, stage, starred,
			lat, lng, geo_status, notes, source, first_seen)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?, '${DEMO_SOURCE}', date('now', 'localtime', ?))`
	);
	const price = db.prepare(`INSERT OR REPLACE INTO listing_prices (listing_id, date, price) VALUES (?, date('now', 'localtime', ?), ?)`);
	const saving = db.prepare(`INSERT INTO savings (date, balance, note) VALUES (date('now', 'localtime', 'start of month', ?), ?, '${DEMO_NOTE}')`);
	db.exec('BEGIN');
	try {
		for (const [address, city, state, zip, p, was, beds, baths, sqft, hoa, homeType, yearBuilt, dom, jur, stage, starred, lat, lng, notes] of LISTINGS) {
			const ago = `-${dom} days`;
			const { lastInsertRowid: id } = listing.run(address, city, state, zip, p, beds, baths, sqft, hoa, homeType, yearBuilt, dom, jur, stage, starred, lat, lng, notes, ago);
			if (was) {
				price.run(id, ago, was);
				price.run(id, '-7 days', p);
			} else price.run(id, ago, p);
		}
		SAVINGS.forEach((balance, i) => saving.run(`-${SAVINGS.length - 1 - i} months`, balance));
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

export function clearDemo(db: DatabaseSync) {
	db.prepare('DELETE FROM listings WHERE source = ?').run(DEMO_SOURCE);
	db.prepare('DELETE FROM savings WHERE note = ?').run(DEMO_NOTE);
}
