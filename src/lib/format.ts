const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $1,234 (whole dollars). */
export function money(n: number | null | undefined, signed = false): string {
	if (n == null || Number.isNaN(n)) return '—';
	const s = usd.format(Math.round(n));
	return signed && n > 0 ? '+' + s : s;
}

/** $412k / $1.2M */
export function k(n: number | null | undefined, signed = false): string {
	if (n == null || Number.isNaN(n)) return '—';
	const a = Math.abs(n);
	const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`;
	return (n < 0 ? '-' : signed && n > 0 ? '+' : '') + s;
}

/** 7.40% (value already in percent). */
export function pct(n: number | null | undefined, digits = 2, signed = false): string {
	if (n == null || Number.isNaN(n)) return '—';
	return `${signed && n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

/** CSS class for good / bad changes; `higherIsGood` flips the sense. */
export function tone(n: number | null | undefined, higherIsGood = true) {
	if (n == null || n === 0 || Number.isNaN(n)) return '';
	return n > 0 === higherIsGood ? 'pos' : 'neg';
}

export function prettyDate(d: string | null | undefined) {
	if (!d) return '—';
	return new Date(d.length === 10 ? d + 'T12:00:00' : d.length === 7 ? d + '-15T12:00:00' : d).toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
}

export function monthLabel(ym: string) {
	return new Date(ym.slice(0, 7) + '-15T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function ago(iso: string | null | undefined) {
	if (!iso) return 'never';
	const t = new Date(iso.includes('T') || iso.endsWith('Z') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
	const m = Math.round((Date.now() - t) / 60000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
	return `${Math.round(m / 1440)}d ago`;
}

export function daysUntil(date: string) {
	return Math.ceil((new Date(date + 'T00:00:00').getTime() - Date.now()) / 86_400_000);
}
