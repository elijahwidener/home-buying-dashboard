import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { get, run } from '#lib/server/db.js';

const UA = 'home-dashboard/1.0 (personal use)';

export interface SourceRow {
	key: string;
	label: string;
	last_modified: string | null;
	checked_at: string | null;
	updated_at: string | null;
	status: string;
	message: string;
}

export function sourceRow(key: string): SourceRow | undefined {
	return get<SourceRow>('SELECT * FROM sources WHERE key = ?', key);
}

/** Run a fetch job and record the outcome. The job returns a short status message. */
export async function job(key: string, label: string, fn: (prev: SourceRow | undefined) => Promise<{ message: string; lastModified?: string | null; changed?: boolean }>) {
	const prev = sourceRow(key);
	run('INSERT INTO sources (key, label) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label', key, label);
	try {
		const r = await fn(prev);
		run(
			`UPDATE sources SET status = 'ok', message = ?, checked_at = datetime('now'),
			 updated_at = CASE WHEN ? THEN datetime('now') ELSE updated_at END,
			 last_modified = COALESCE(?, last_modified) WHERE key = ?`,
			r.message,
			r.changed === false ? 0 : 1,
			r.lastModified ?? null,
			key
		);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`[refresh] ${key}: ${msg}`);
		run(`UPDATE sources SET status = 'error', message = ?, checked_at = datetime('now') WHERE key = ?`, msg.slice(0, 300), key);
	}
}

export async function fetchOk(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
	const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res;
}

export async function lastModified(url: string): Promise<string | null> {
	const res = await fetchOk(url, { method: 'HEAD' }, 20_000);
	return res.headers.get('last-modified');
}

/** Stream a (possibly huge) text response line by line. */
export async function* lines(res: Response): AsyncGenerator<string> {
	if (!res.body) return;
	const rl = createInterface({ input: Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), crlfDelay: Infinity });
	for await (const line of rl) yield line;
}

/** Split one CSV line, honoring quotes. */
export function csvSplit(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (q) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') q = false;
			else cur += c;
		} else if (c === '"') q = true;
		else if (c === ',') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out;
}

/** Parse a whole CSV document (small files: uploads, FRED). Handles quoted newlines. */
export function csvParse(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (q) {
			if (c === '"' && text[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') q = false;
			else cur += c;
		} else if (c === '"') q = true;
		else if (c === ',') {
			row.push(cur);
			cur = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(cur);
			if (row.some((v) => v !== '')) rows.push(row);
			row = [];
			cur = '';
		} else cur += c;
	}
	row.push(cur);
	if (row.some((v) => v !== '')) rows.push(row);
	return rows;
}
