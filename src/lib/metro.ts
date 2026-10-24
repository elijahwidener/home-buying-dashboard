// Metro lines and stations for the map (built by scripts/build-metro.mjs from DC GIS data).
import metro from './metro.json' with { type: 'json' };

export interface Station {
	name: string;
	lines: string[];
	lat: number;
	lng: number;
}

export interface MetroLine {
	name: string;
	color: string;
	/** [lat, lng] */
	coords: [number, number][];
}

export const METRO = metro as { source: string; lines: MetroLine[]; stations: Station[] };
