import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** Download a consistent copy of the database (safe while the app is running). */
export const GET: RequestHandler = () => {
	const file = join(tmpdir(), `homebuy-backup-${Date.now()}.db`);
	db().prepare('VACUUM INTO ?').run(file);
	const bytes = readFileSync(file);
	rmSync(file, { force: true });
	const stamp = new Date().toLocaleDateString('en-CA');
	return new Response(bytes, {
		headers: {
			'content-type': 'application/vnd.sqlite3',
			'content-disposition': `attachment; filename="home-dashboard-${stamp}.db"`
		}
	});
};
