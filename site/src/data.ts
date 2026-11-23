// Loads the JSON the daily pipeline exports (pipeline/export.py) from this site's own /data/.
export type Scenario = 'low' | 'cons' | 'high';
export const SCENARIOS: Scenario[] = ['low', 'cons', 'high'];
export const SCENARIO_NAME: Record<Scenario, string> = { low: 'pessimistic', cons: 'central', high: 'optimistic' };

export interface Meta {
  pintail_commit: string; through_epoch: number; through_time: string; dataset_generated: string;
  latest_frame: string; eth: number; generated: string;
}
export type History = Record<string, (number | string)[]> & { date: string[]; epoch: number[] };
/** A plot: side w tiles, h storeys per scenario (fractional), so w*w*h*block_eth = eth. mix: [alloc index, eth]. */
export interface Plot {
  n: string; k: 'op' | 'csm' | 'rp' | 'un'; x: number; y: number; w: number;
  h: number[]; eth: number[]; mix: [number, number][][];
}
export interface City {
  block_eth: number; cells: number; scenarios: Scenario[]; allocs: string[]; alloc_names: string[];
  plots: Plot[]; half: Record<Scenario, number[]>; total: number[];
  /** Each funding source's arc of the city, [from, to] radians of atan2(tile y, tile x). */
  arcs: Record<string, [number, number]>;
  /** Buildings under one block, per scenario, flat: cell x, cell y, side k cells, storeys × 1000, alloc index. */
  small: Record<Scenario, number[]>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export const load = {
  meta: () => get<Meta>('meta.json'),
  history: () => get<History>('history.json'),
  city: () => get<City>('city.json'),
};

/** Pintail's live manifest, to show whether this page is behind their latest dataset. */
export async function pintailLatest(): Promise<{ through_time: string; commit: string } | null> {
  try {
    const r = await fetch('https://pintail.xyz/staking/treemap/data/dataset/manifest.json', { cache: 'no-store' });
    if (!r.ok) return null;
    const m = await r.json();
    return { through_time: m.through_time, commit: m.provenance?.commit };
  } catch {
    return null;
  }
}

/** Shared scenario state, mirrored in the URL (?s=low|cons|high). */
type Listener = (s: Scenario) => void;
const listeners = new Set<Listener>();
let current: Scenario = (() => {
  const s = new URLSearchParams(location.search).get('s');
  return (SCENARIOS as string[]).includes(s ?? '') ? (s as Scenario) : 'low';
})();
export const scenario = {
  get: () => current,
  set(s: Scenario) {
    current = s;
    const u = new URL(location.href);
    if (s === 'low') u.searchParams.delete('s'); else u.searchParams.set('s', s);
    history.replaceState(null, '', u);
    listeners.forEach((f) => f(s));
  },
  on(f: Listener) { listeners.add(f); f(current); },
};
