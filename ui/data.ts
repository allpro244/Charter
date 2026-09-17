// Loads the built data files. They are served from data/ as Vite's public
// directory, so /counties.json is data/counties.json. Missing files are
// reported by name with the command that builds them (rule 17).

import type { WorldData } from '../data/types';

export interface GeoFeature {
  type: 'Feature';
  properties: { fips: string; name: string; state: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface Loaded {
  data: WorldData;
  geo: GeoCollection;
  manifest: Record<string, unknown> | null;
}

const FILES = ['counties.json', 'metros.json', 'states.json', 'banks-by-state.json', 'national.json', 'counties.geo.json'];

// A packed page carries every data file inside one script element.
function inlineBundle(): Record<string, unknown> | null {
  const el = typeof document === 'undefined' ? null : document.getElementById('charter-data');
  if (!el || !el.textContent) return null;
  try {
    const parsed = JSON.parse(el.textContent) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function loadData(): Promise<{ ok: true; loaded: Loaded } | { ok: false; missing: string[] }> {
  const bundle = inlineBundle();
  if (bundle) {
    const missing = FILES.filter((f) => !(f in bundle)).map((f) => `data/${f}`);
    if (missing.length > 0) return { ok: false, missing };
    const get = (f: string) => bundle[f];
    return {
      ok: true,
      loaded: {
        data: {
          counties: get('counties.json') as WorldData['counties'],
          metros: get('metros.json') as WorldData['metros'],
          states: get('states.json') as WorldData['states'],
          banksByState: get('banks-by-state.json') as WorldData['banksByState'],
          national: get('national.json') as WorldData['national'],
        },
        geo: get('counties.geo.json') as GeoCollection,
        manifest: (bundle['manifest.json'] as Record<string, unknown> | undefined) ?? null,
      },
    };
  }
  const results = await Promise.all(
    FILES.map(async (f) => {
      try {
        const res = await fetch(`./${f}`);
        if (!res.ok) return { f, json: null };
        const text = await res.text();
        // Vite's dev server answers index.html for unknown paths.
        if (text.trimStart().startsWith('<')) return { f, json: null };
        return { f, json: JSON.parse(text) as unknown };
      } catch {
        return { f, json: null };
      }
    }),
  );
  const missing = results.filter((r) => r.json === null).map((r) => `data/${r.f}`);
  if (missing.length > 0) return { ok: false, missing };
  const get = (f: string) => results.find((r) => r.f === f)!.json;
  let manifest: Record<string, unknown> | null = null;
  try {
    const res = await fetch('./manifest.json');
    if (res.ok) {
      const text = await res.text();
      if (!text.trimStart().startsWith('<')) manifest = JSON.parse(text);
    }
  } catch {
    manifest = null;
  }
  return {
    ok: true,
    loaded: {
      data: {
        counties: get('counties.json') as WorldData['counties'],
        metros: get('metros.json') as WorldData['metros'],
        states: get('states.json') as WorldData['states'],
        banksByState: get('banks-by-state.json') as WorldData['banksByState'],
        national: get('national.json') as WorldData['national'],
      },
      geo: get('counties.geo.json') as GeoCollection,
      manifest,
    },
  };
}
