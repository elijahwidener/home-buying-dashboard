// Headlines from RSS feeds (Google News searches by default; any RSS URL works).
import type { Config } from '#lib/config.js';
import { run, tx } from '#lib/server/db.js';
import { fetchOk, job } from './common.ts';

const decode = (s: string) =>
	s
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&amp;/g, '&')
		.trim();

const tag = (xml: string, name: string) => {
	const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
	return m ? decode(m[1]) : '';
};

export async function refreshNews(cfg: Config) {
	for (const feed of cfg.feeds) {
		await job(`news:${feed.name}`, `News · ${feed.name}`, async () => {
			const xml = await (await fetchOk(feed.url, {}, 30_000)).text();
			const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)].map((m) => m[0]);
			let added = 0;
			tx(() => {
				for (const it of items.slice(0, 40)) {
					const link = tag(it, 'link');
					let title = tag(it, 'title');
					const source = tag(it, 'source');
					// Google News appends " - Source" to titles.
					if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
					const when = new Date(tag(it, 'pubDate'));
					if (!link || !title) continue;
					const r = run(
						'INSERT OR IGNORE INTO news (link, feed, title, source, published) VALUES (?, ?, ?, ?, ?)',
						link,
						feed.name,
						title,
						source,
						Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString()
					);
					added += Number(r.changes);
				}
			});
			return { message: `${items.length} items, ${added} new` };
		});
	}
	run("DELETE FROM news WHERE published < datetime('now', '-90 days')");
}
