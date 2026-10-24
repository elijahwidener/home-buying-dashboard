/** Parse a form number; empty → null. */
export function num(v: FormDataEntryValue | null): number | null {
	if (v == null || String(v).trim() === '') return null;
	const n = Number(String(v).replace(/[$,\s]/g, ''));
	return Number.isFinite(n) ? n : null;
}

export function str(v: FormDataEntryValue | null): string {
	return v == null ? '' : String(v).trim();
}

export function int(v: string | undefined): number {
	const n = Number(v);
	return Number.isInteger(n) ? n : NaN;
}
