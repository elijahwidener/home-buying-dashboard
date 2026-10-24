import { fail } from '@sveltejs/kit';
import { monthsBetween } from '#lib/finance.js';
import { all, currentSavings, getSetting, loadConfig, run, setSetting } from '#lib/server/db.js';
import { areaAnalyses, rates } from '#lib/server/live.js';
import { int, num, str } from '#lib/server/params.js';
import type { Actions, PageServerLoad } from './$types';

interface Step {
	text: string;
	when: string;
	done: boolean;
}

const DEFAULT_STEPS: Step[] = [
	{ text: 'Keep retirement contributions at least at the employer match; save into a separate house fund', when: 'Now', done: false },
	{ text: 'Pull your credit reports and fix any errors', when: 'Now', done: false },
	{ text: 'If family is helping, decide gift vs. loan and put it in writing', when: '6+ months out', done: false },
	{ text: 'Talk to 2–3 lenders; get pre-approved', when: '4–6 months out', done: false },
	{ text: 'Tour open houses in your top areas', when: '3–6 months out', done: false },
	{ text: 'Import Redfin searches weekly; track price cuts and days on market', when: 'While searching', done: false },
	{ text: 'On homes that have sat, ask for seller credits toward a rate buydown', when: 'When offering', done: false },
	{ text: 'Go under contract; line up inspection, appraisal and insurance', when: '2–3 months out', done: false }
];

function steps(): Step[] {
	try {
		return JSON.parse(getSetting('steps') ?? '') as Step[];
	} catch {
		return DEFAULT_STEPS;
	}
}

export const load: PageServerLoad = () => {
	const cfg = loadConfig();
	const r = rates(cfg);
	const entries = all<{ id: number; date: string; balance: number; note: string }>('SELECT * FROM savings ORDER BY date, id');
	const areas = areaAnalyses(cfg, r.yours).map((x) => ({ name: x.area.name, cash: x.a.cash.total }));
	const current = currentSavings(cfg);
	const today = new Date().toLocaleDateString('en-CA');
	return { cfg, entries, areas, current, steps: steps(), today, monthsLeft: monthsBetween(today.slice(0, 7), cfg.profile.targetClose) };
};

export const actions: Actions = {
	log: async ({ request }) => {
		const f = await request.formData();
		const balance = num(f.get('balance'));
		const date = str(f.get('date'));
		if (balance == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, { error: 'Date and balance are required.' });
		run('INSERT INTO savings (date, balance, note) VALUES (?, ?, ?)', date, balance, str(f.get('note')));
	},
	unlog: async ({ request }) => {
		const f = await request.formData();
		run('DELETE FROM savings WHERE id = ?', int(str(f.get('id'))));
	},
	toggle: async ({ request }) => {
		const f = await request.formData();
		const i = int(str(f.get('i')));
		const s = steps();
		if (s[i]) s[i].done = !s[i].done;
		setSetting('steps', JSON.stringify(s));
	},
	addStep: async ({ request }) => {
		const f = await request.formData();
		const text = str(f.get('text'));
		if (!text) return fail(400, { error: 'Describe the step.' });
		setSetting('steps', JSON.stringify([...steps(), { text, when: str(f.get('when')), done: false }]));
	},
	removeStep: async ({ request }) => {
		const f = await request.formData();
		const i = int(str(f.get('i')));
		setSetting('steps', JSON.stringify(steps().filter((_, j) => j !== i)));
	}
};
