// <nakamoto-band>: the operator Nakamoto over time as a band across the three scenarios, plain SVG.
import { load, scenario, SCENARIOS, SCENARIO_NAME, type History, type Scenario } from '../data';

const W = 960, H = 380, M = { t: 16, r: 120, b: 32, l: 36 };
const Y_MAX = 24, START = '2021-06-01', MERGE = '2022-09-15', DANGER = 10;
const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

class NakamotoBand extends HTMLElement {
  private svg!: SVGSVGElement;
  private h!: History;
  private idx: number[] = [];

  async connectedCallback() {
    this.h = await load.history();
    this.idx = this.h.date.map((d, i) => [d, i] as const).filter(([d]) => d >= START).map(([, i]) => i);
    this.render();
    scenario.on((s) => this.select(s));
  }

  private t(d: string) { return Date.parse(d); }

  private render() {
    const h = this.h, I = this.idx;
    const t0 = this.t(h.date[I[0]]), t1 = this.t(h.date[I[I.length - 1]]) + 28 * 864e5;   // last frame drawn for a step
    const x = (d: string) => M.l + ((this.t(d) - t0) / (t1 - t0)) * (W - M.l - M.r);
    const y = (v: number) => M.t + (1 - Math.min(v, Y_MAX) / Y_MAX) * (H - M.t - M.b);
    const svg = (this.svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': 'Operator Nakamoto coefficient over time, three scenarios' }));
    this.appendChild(svg);

    el('rect', { class: 'zone', x: M.l, y: y(DANGER), width: W - M.l - M.r, height: y(0) - y(DANGER) }, svg);
    const zl = el('text', { class: 'zone-label', x: M.l + 8, y: y(DANGER) + 16 }, svg); zl.textContent = 'below 10: danger zone';
    const grid = el('g', { class: 'grid axis' }, svg);
    for (let v = 0; v <= Y_MAX; v += 5) {
      el('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v) }, grid);
      const tx = el('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, grid); tx.textContent = String(v);
    }
    for (let yr = 2022; yr <= 2030; yr++) {
      const d = `${yr}-01-01`;
      if (this.t(d) <= t0 || this.t(d) >= t1) continue;
      const tx = el('text', { x: x(d), y: H - 8, 'text-anchor': 'middle' }, grid); tx.textContent = String(yr);
    }
    const mk = el('g', { class: 'marker' }, svg);
    el('line', { x1: x(MERGE), x2: x(MERGE), y1: M.t, y2: y(0) }, mk);
    const mt = el('text', { x: x(MERGE) + 6, y: M.t + 12 }, mk); mt.textContent = 'The Merge';

    // step paths: each frame's value holds until the next frame
    const end = new Date(t1).toISOString().slice(0, 10);
    const step = (key: string) => I.map((i, k) => {
      const d0 = h.date[i], d1 = k + 1 < I.length ? h.date[I[k + 1]] : end;
      const v = Number(h[key][i]);
      return `${k ? 'L' : 'M'}${x(d0)},${y(v)}H${x(d1)}`;
    }).join('');
    const lo = I.map((i) => Math.min(...SCENARIOS.map((s) => Number(h[`op_n50_${s}`][i]))));
    const hi = I.map((i) => Math.max(...SCENARIOS.map((s) => Number(h[`op_n50_${s}`][i]))));
    const top = I.map((i, k) => `${k ? 'L' : 'M'}${x(h.date[i])},${y(hi[k])}H${x(k + 1 < I.length ? h.date[I[k + 1]] : end)}`).join('');
    const bot = [...I].reverse().map((i, r) => {
      const k = I.length - 1 - r;
      return `L${x(k + 1 < I.length ? h.date[I[k + 1]] : end)},${y(lo[k])}H${x(h.date[i])}`;
    }).join('');
    el('path', { class: 'band', d: top + bot + 'Z' }, svg);
    for (const s of SCENARIOS) el('path', { class: 'line', 'data-s': s, d: step(`op_n50_${s}`) }, svg);

    // end labels: scenarios with the same value share one label; labels are pushed apart if close
    const last = I[I.length - 1];
    const lbl = el('g', { class: 'axis' }, svg);
    const byVal = new Map<number, string[]>();
    for (const s of SCENARIOS) {
      const v = Number(h[`op_n50_${s}`][last]);
      byVal.set(v, [...(byVal.get(v) ?? []), SCENARIO_NAME[s]]);
    }
    let prevY = -Infinity;
    [...byVal.entries()].sort((p, q) => q[0] - p[0]).forEach(([v, names]) => {
      const ty = Math.max(y(v) + 4, prevY + 14); prevY = ty;
      const t = el('text', { x: W - M.r + 8, y: ty }, lbl);
      t.textContent = `${v}  ${names.join(', ')}`;
    });

    // hover readout
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; this.appendChild(tip);
    const hv = el('g', { class: 'hover' }, svg); const hl = el('line', { y1: M.t, y2: y(0) }, hv); hv.style.display = 'none';
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect(), px = ((ev.clientX - r.left) / r.width) * W;
      let k = I.findIndex((i, j) => j + 1 === I.length || x(h.date[I[j + 1]]) > px);
      if (k < 0) k = I.length - 1;
      const i = I[k], xv = x(h.date[i]);
      hl.setAttribute('x1', String(xv)); hl.setAttribute('x2', String(xv)); hv.style.display = '';
      tip.hidden = false; tip.style.left = `${(xv / W) * r.width}px`; tip.style.top = `${(M.t / H) * r.height + 24}px`;
      tip.textContent = `${h.date[i]}: ${h.op_n50_low[i]} / ${h.op_n50_cons[i]} / ${h.op_n50_high[i]}`;
    });
    svg.addEventListener('pointerleave', () => { tip.hidden = true; hv.style.display = 'none'; });
  }

  private select(s: Scenario) {
    this.svg?.querySelectorAll<SVGPathElement>('.line').forEach((p) => p.classList.toggle('sel', p.dataset.s === s));
  }
}
customElements.define('nakamoto-band', NakamotoBand);
