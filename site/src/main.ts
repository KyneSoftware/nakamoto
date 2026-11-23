import './components/nakamoto-band';
import './components/stake-city';
import { load, pintailLatest, scenario, SCENARIOS, type Scenario } from './data';

const $ = (id: string) => document.getElementById(id)!;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// theme toggle: light ↔ dark, remembered per browser where storage is allowed
$('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
});

document.querySelectorAll<HTMLButtonElement>('.scenario button').forEach((b) =>
  b.addEventListener('click', () => scenario.set(b.dataset.s as Scenario)));
scenario.on((s) => document.querySelectorAll<HTMLButtonElement>('.scenario button')
  .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === s))));

async function headline() {
  const [h, meta] = await Promise.all([load.history(), load.meta()]);
  const n = h.date.length - 1;
  const v = (k: string, i = n) => Number(h[k][i]);
  const range = (i: number) => {
    const xs = SCENARIOS.map((s) => v(`op_n50_${s}`, i));
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };
  // Lead with the top-7 share when it sits near half, as the README does.
  $('h-top7').textContent = 'Seven';
  $('h-top7-share').textContent = pct(v('op_top7_share_low'));
  const lo = v('op_n50_low');
  $('h-lede').textContent = `On the pessimistic count, ${WORDS[lo] ?? lo} run more than half. ` +
    `At the Merge it was ${range(h.date.findIndex((d) => d >= '2022-09-15'))}; ` +
    `it peaked at ${range(peakIndex())} in ${month(h.date[peakIndex()])}. Data through ${meta.latest_frame}.`;
  $('t-n50').textContent = range(n);
  $('t-merge').textContent = range(h.date.findIndex((d) => d >= '2022-09-15'));
  $('t-peak').textContent = range(peakIndex());
  $('t-peak-date').textContent = month(h.date[peakIndex()]);
  $('t-known').textContent = pct(v('op_known'));

  function peakIndex() {
    let best = 0, bi = 0;
    h.date.forEach((d, i) => { if (d >= '2022-09-15' && v('op_n50_low', i) > best) { best = v('op_n50_low', i); bi = i; } });
    return bi;
  }

  const live = await pintailLatest();
  const ours = meta.through_time.slice(0, 10);
  $('fresh').textContent = live && live.through_time.slice(0, 10) > ours
    ? `This page: pintail data through ${ours}. Pintail now has data through ${live.through_time.slice(0, 10)}; the next daily rebuild will pick it up.`
    : `Pintail data through ${ours} (dataset commit ${meta.pintail_commit.slice(0, 8)}). Rebuilt daily.`;
}

function month(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

headline().catch((e) => { $('h-lede').textContent = `Could not load data: ${e.message}`; });
