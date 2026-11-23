// <stake-city>: operators as towers, small stakers as low buildings. Volume is stake throughout:
// one tile-storey is city.block_eth (2,048 ETH), one cell-storey (1/8 × 1/8 tile) is 32 ETH, one validator.
// Every building is inset and every storey gapped by the same fraction of its size, so the drawn volumes
// stay in proportion to stake from the largest tower to a single validator.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { load, scenario, SCENARIOS, type City, type Plot, type Scenario } from '../data';

const STOREY = 0.55;      // storey height, in tiles
const INSET = 0.08;       // gap on each side of a building, as a fraction of its plot side
const SGAP = 0.12;        // gap above each storey, as a fraction of a storey

type Mode = 'nakamoto' | 'livery' | 'withdraws';
const MODES: [Mode, string][] = [['nakamoto', 'Nakamoto'], ['livery', 'Operators'], ['withdraws', 'Withdraws to']];

// "Withdraws to" categories in legend order: where a validator's stake is withdrawn to, not who put it up. Lido's modules (curated, Simple DVT, CSM) share one colour; hover names them.
const CATS = ['lido', 'rocket-pool', 'custody-coinbase', 'eigenpod', 'custody-other', 'exchange', 'unattributed', 'other'] as const;
// Stacking order, bottom first: Lido at the top of every tower, so its reach into the biggest ones shows.
// Neighbouring hues were checked for colour-blind separation in this order.
const STACK = ['other', 'unattributed', 'exchange', 'custody-other', 'eigenpod', 'custody-coinbase', 'rocket-pool', 'lido'] as const;
type Cat = (typeof CATS)[number];
const CAT_LABEL: Record<Cat, string> = {
  lido: 'Lido', 'rocket-pool': 'Rocket Pool',
  'custody-coinbase': 'Coinbase custody', eigenpod: 'EigenPods', 'custody-other': 'BitGo or undisclosed custodian',
  exchange: 'Exchanges', unattributed: 'unattributed', other: 'other allocators',
};
const CAT_VAR: Record<Cat, string> = {
  lido: '--c-lido', 'rocket-pool': '--c-rp', 'custody-coinbase': '--c-cbcust', eigenpod: '--c-eigen', 'custody-other': '--c-cust', exchange: '--c-exch',
  unattributed: '--c-unattr', other: '--c-other',
};

// Operators mode colours the named operators that together run this share of all stake.
const LIVERY_SHARE = 0.8;
// Each operator's brand colour, from its own site, logo or favicon (researched Nov 2026). Monochrome brands use
// their main accent; where there is none they fall back to a stable hue from the name. Lightness is clamped by
// liveryColor so near-black and near-white brands stay visible on both themes. Identity is carried by the labels
// and hover, not the colour, so look-alike brands (several blues, several limes) are left as they are.
const LIVERY: Record<string, string> = {
  Coinbase: '#0052ff', 'BitMine (MAVAN, Pier Two)': '#c6ff00', 'Kraken (incl. Staked)': '#7132f5', Binance: '#f0b90b',
  Figment: '#fff850', Blockdaemon: '#5844d7', Everstake: '#40c1ac', Galaxy: '#7cccff', 'P2P.org': '#1347ff',
  Kiln: '#ff6521', Allnodes: '#21d4fd', Stakefish: '#b4e600', OKX: '#bcff2f', 'Bitcoin Suisse': '#e42949',
  Upbit: '#0062df', Twinstake: '#547df9', Grayscale: '#2b2049', 'Hashkey Cloud': '#002fa7', Ebunker: '#ccff00',
  'The Tie': '#72d64c', Dsrv: '#0c58f5', Infstones: '#edb500', Luganodes: '#be1e2e', Rocklogic: '#256258',
  Stakely: '#163e9b', Blockscape: '#ffa400', 'Offchain Labs': '#12aaff', 'Gateway Fm': '#5b35b8', Solstice: '#eb6237',
  Chainsafe: '#feff48', 'Parafi Technologies': '#52b788', Rockawayx: '#24bd40', Senseinode: '#3f3ff9',
  'Staking Facilities': '#4755a4', 'Kukis Global': '#18b59e', Rockx: '#006acb', 'Simply Staking': '#f23d4c',
  Chainlayer: '#69c498', StakeWise: '#47347e', Gemini: '#ff4809', Etherfi: '#6760ac',
};
function hueOf(name: string) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.62, 0.52);
}
/** The operator's colour, its lightness kept within a band that reads on the light and the dark background. */
function liveryColor(name: string) {
  const hex = LIVERY[name] ?? LIVERY[name.split('/')[0]];
  if (!hex) return hueOf(name);
  const c = new THREE.Color(hex), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s, Math.min(0.7, Math.max(0.4, hsl.l)));
}

function cssColor(el: Element, name: string) {
  return new THREE.Color(getComputedStyle(el).getPropertyValue(name).trim() || '#888');
}
const fmt = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : Math.round(v).toLocaleString('en-US'));

class StakeCity extends HTMLElement {
  private city!: City;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.5, 4000);
  private controls!: OrbitControls;
  private towers?: THREE.InstancedMesh;
  private smalls?: THREE.InstancedMesh;
  private owner: number[] = [];                       // tower instance → plot index
  private cellMap = new Map<number, number>();        // cell key → small building index (current scenario)
  private tip = document.createElement('div');
  private labels = document.createElement('div');
  private legendEl = document.createElement('div');
  private caption = document.createElement('p');
  private frame = 0;
  private extent = 60;
  private mode: Mode = 'nakamoto';
  private picked = new Set<Cat>();
  private faced = false;
  private livery = { set: new Set<number>(), share: 0, named: 0, namedShare: 0 };
  private catOf: Cat[] = [];

  async connectedCallback() {
    this.city = await load.city();
    this.catOf = this.city.allocs.map((a) => (a.startsWith('lido') ? 'lido' : (CATS as readonly string[]).includes(a) ? (a as Cat) : 'other'));
    const q = new URLSearchParams(location.search);
    if (MODES.some(([m]) => m === q.get('c'))) this.mode = q.get('c') as Mode;
    for (const f of (q.get('f') ?? '').split(',')) if ((CATS as readonly string[]).includes(f)) this.picked.add(f as Cat);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.appendChild(this.renderer.domElement);
    this.labels.className = 'labels'; this.appendChild(this.labels);
    this.tip.className = 'tip'; this.tip.hidden = true; this.appendChild(this.tip);
    this.toolbar();
    this.legendEl.className = 'legend'; this.appendChild(this.legendEl);
    this.caption.className = 'note city-caption'; this.after(this.caption);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(60, 120, 40); this.scene.add(sun);

    let r = 0;
    for (const p of this.city.plots) r = Math.max(r, Math.abs(p.x) + p.w, Math.abs(p.y) + p.w);
    const s = this.city.small;
    for (const k of SCENARIOS) for (let i = 0; i < s[k].length; i += 5) r = Math.max(r, Math.abs(s[k][i]) / this.city.cells + 1, Math.abs(s[k][i + 1]) / this.city.cells + 1);
    this.extent = r;

    this.camera.position.set(1, 0.8, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 9, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = this.extent * 6;
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    new ResizeObserver(() => this.resize()).observe(this);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.renderer.domElement.addEventListener('pointerleave', () => (this.tip.hidden = true));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.build());
    new MutationObserver(() => this.build()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    scenario.on(() => this.build());
    const tick = () => {
      this.frame = requestAnimationFrame(tick);
      this.controls.update(); this.renderer.render(this.scene, this.camera); this.placeLabels();
    };
    tick();
  }

  disconnectedCallback() { cancelAnimationFrame(this.frame); this.renderer?.dispose(); }

  private resize() {
    const w = this.clientWidth, h = this.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = (this.extent * 2.1) / Math.min(1, this.camera.aspect);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    if (this.mode === 'withdraws' && !this.faced) this.faceArcs();
  }

  /** Swing the camera round to look across the Lido and Rocket Pool arcs at the towers, and hold it there. */
  private faceArcs() {
    const a = this.city.arcs, th = (a.lido[0] + a['rocket-pool'][1]) / 2;
    const off = this.camera.position.clone().sub(this.controls.target);
    const flat = Math.hypot(off.x, off.z);
    this.camera.position.set(this.controls.target.x + flat * Math.cos(th), this.camera.position.y, this.controls.target.z + flat * Math.sin(th));
    this.controls.autoRotate = false; this.faced = true;
  }

  private toolbar() {
    const bar = document.createElement('div'); bar.className = 'city-modes scenario'; bar.setAttribute('role', 'radiogroup');
    bar.setAttribute('aria-label', 'Colour buildings by');
    for (const [m, label] of MODES) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.m = m;
      b.addEventListener('click', () => { this.mode = m; this.syncUrl(); if (m === 'withdraws') this.faceArcs(); this.build(); });
      bar.appendChild(b);
    }
    this.appendChild(bar);
  }

  private syncUrl() {
    const u = new URL(location.href);
    if (this.mode === 'nakamoto') u.searchParams.delete('c'); else u.searchParams.set('c', this.mode);
    if (this.mode === 'withdraws' && this.picked.size) u.searchParams.set('f', [...this.picked].join(',')); else u.searchParams.delete('f');
    history.replaceState(null, '', u);
  }

  /** Colour of one stack segment (or whole building) in the current mode. */
  private palette() {
    const c = (v: string) => cssColor(this, v);
    const cat = Object.fromEntries(CATS.map((k) => [k, c(CAT_VAR[k])])) as Record<Cat, THREE.Color>;
    return { half: c('--accent'), other: c('--city-other'), small: c('--sprawl'), faded: c('--city-faded'), cat };
  }

  private build() {
    const s = scenario.get(), k = SCENARIOS.indexOf(s), c = this.city, B = c.block_eth;
    const half = new Set(c.half[s]);
    const P = this.palette();
    this.querySelectorAll<HTMLButtonElement>('.city-modes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === this.mode)));

    const segColor = (cat: Cat) => (this.picked.size && !this.picked.has(cat) ? P.faded : P.cat[cat]);
    // Operators mode: the largest named operators until together they run LIVERY_SHARE of all stake
    const named = c.plots.map((p, i) => [p, i] as const).filter(([p]) => p.k === 'op' && p.eth[k] > 0).sort((a, b) => b[0].eth[k] - a[0].eth[k]);
    const liv = new Set<number>();
    let acc = 0;
    for (const [p, i] of named) { if (acc >= LIVERY_SHARE * c.total[k]) break; liv.add(i); acc += p.eth[k]; }
    this.livery = { set: liv, share: acc / c.total[k], named: named.length, namedShare: named.reduce((a, [p]) => a + p.eth[k], 0) / c.total[k] };
    const plotColor = (pi: number, p: Plot) => {
      if (this.mode === 'livery') return liv.has(pi) ? liveryColor(p.n) : P.other;
      return half.has(pi) ? P.half : P.other;
    };

    // towers: one slab per storey (the top one partial), split by withdrawal destination in "Withdraws to"
    type Piece = { pi: number; x: number; z: number; side: number; y0: number; y1: number; col: THREE.Color };
    const pieces: Piece[] = [];
    c.plots.forEach((p, pi) => {
      const H = p.h[k]; if (!(H > 0)) return;
      const side = p.w * (1 - 2 * INSET), x = p.x + p.w * INSET, z = p.y + p.w * INSET;
      let segs: [number, THREE.Color][];
      if (this.mode === 'withdraws') {
        const by = new Map<Cat, number>();
        for (const [a, eth] of p.mix[k]) by.set(this.catOf[a], (by.get(this.catOf[a]) ?? 0) + eth);
        segs = STACK.filter((ct) => by.has(ct)).map((ct) => [(by.get(ct)! / B) / (p.w * p.w), segColor(ct)]);
      } else segs = [[H, plotColor(pi, p)]];
      // walk storeys and segments together in storey units u ∈ [0, H]
      let si = 0, segEnd = segs[0][0];
      for (let f = 0; f < H; f++) {
        let u = f; const top = Math.min(f + 1, H);
        while (u < top - 1e-9) {
          while (si < segs.length - 1 && segEnd <= u + 1e-9) { si++; segEnd += segs[si][0]; }
          const end = Math.min(top, si === segs.length - 1 ? top : segEnd);
          const y = (v: number) => (f + (v - f) * (1 - SGAP)) * STOREY;
          pieces.push({ pi, x, z, side, y0: y(u), y1: y(end), col: segs[si][1] });
          u = end;
        }
      }
    });

    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0.5, 0.5, 0.5);
    const m = new THREE.Matrix4();
    if (this.towers) { this.scene.remove(this.towers); this.towers.dispose(); }
    const towers = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), Math.max(1, pieces.length));
    this.owner = [];
    pieces.forEach((q, i) => {
      m.makeScale(q.side, q.y1 - q.y0, q.side).setPosition(q.x, q.y0, q.z);
      towers.setMatrixAt(i, m); towers.setColorAt(i, q.col); this.owner[i] = q.pi;
    });
    towers.count = pieces.length;
    towers.instanceMatrix.needsUpdate = true;
    if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
    this.scene.add(towers); this.towers = towers;

    // small buildings: side k cells, partial storeys, its own mesh; picked by ground cell, not raycast
    const S = c.small[s], n = S.length / 5, cell = 1 / c.cells;
    if (this.smalls) { this.scene.remove(this.smalls); this.smalls.dispose(); }
    const smalls = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), Math.max(1, n));
    this.cellMap.clear();
    for (let i = 0; i < n; i++) {
      const cx = S[5 * i], cy = S[5 * i + 1], kk = S[5 * i + 2], h = S[5 * i + 3] / 1000, cat = this.catOf[S[5 * i + 4]];
      const side = kk * cell * (1 - 2 * INSET);
      m.makeScale(side, h * STOREY * (1 - SGAP), side).setPosition(cx * cell + kk * cell * INSET, 0, cy * cell + kk * cell * INSET);
      smalls.setMatrixAt(i, m);
      smalls.setColorAt(i, this.mode === 'withdraws' ? segColor(cat) : P.small);
      for (let a = 0; a < kk; a++) for (let b = 0; b < kk; b++) this.cellMap.set((cx + a) * 1e6 + (cy + b), i);
    }
    smalls.count = n;
    smalls.instanceMatrix.needsUpdate = true;
    if (smalls.instanceColor) smalls.instanceColor.needsUpdate = true;
    this.scene.add(smalls); this.smalls = smalls;

    this.makeLabels(this.mode === 'livery' ? liv : half);
    this.legend(half);
  }

  private makeLabels(which: Set<number>) {
    this.labels.replaceChildren();
    for (const pi of which) {
      const p = this.city.plots[pi];
      const el = document.createElement('span'); el.textContent = p.k === 'op' ? p.n : p.n.replace(/ 0x.*/, '');
      el.dataset.pi = String(pi); this.labels.appendChild(el);
    }
  }

  private placeLabels() {
    if (!this.labels.childElementCount) return;
    const k = SCENARIOS.indexOf(scenario.get()), w = this.clientWidth, h = this.clientHeight;
    const v = new THREE.Vector3(), boxes: [number, number, number, number][] = [];
    const els = [...this.labels.children] as HTMLElement[];
    els.sort((a, b) => this.city.plots[+b.dataset.pi!].h[k] - this.city.plots[+a.dataset.pi!].h[k]);
    for (const el of els) {
      const p = this.city.plots[+el.dataset.pi!];
      v.set(p.x + p.w / 2, p.h[k] * STOREY + 0.4, p.y + p.w / 2).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const bw = el.offsetWidth || 80, bh = 18;
      const box: [number, number, number, number] = [x - bw / 2, y - bh, x + bw / 2, y];
      const clash = boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
      const show = v.z < 1 && !clash && x > 0 && x < w && y > 0 && y < h;
      el.style.visibility = show ? 'visible' : 'hidden';
      if (show) { boxes.push(box); el.style.transform = `translate(${x - bw / 2}px, ${y - bh}px)`; }
    }
  }

  private legend(half: Set<number>) {
    const s = scenario.get(), k = SCENARIOS.indexOf(s), c = this.city;
    const sw = (v: string) => `<i style="background:var(${v})"></i>`;
    const scale = `<span class="scale">Volume = stake: a tile-storey is ${c.block_eth.toLocaleString('en-US')} ETH; the smallest buildings are one 32 ETH validator.</span>`;
    if (this.mode !== 'withdraws') {
      this.legendEl.innerHTML =
        (this.mode === 'livery' ? `<span><i style="background:linear-gradient(90deg,${Object.values(LIVERY).slice(0, 8).join(',')})"></i>the ${this.livery.set.size} named operators that together run over ${Math.round(LIVERY_SHARE * 100)}% of all stake, one colour each</span>`
          : `<span>${sw('--accent')}together run over half of all stake</span>`) +
        `<span>${sw('--city-other')}other operators and groups over ${c.block_eth.toLocaleString('en-US')} ETH</span>` +
        `<span>${sw('--sprawl')}under ${c.block_eth.toLocaleString('en-US')} ETH</span>` + scale;
      const L = this.livery, pc = (v: number) => `${Math.round(v * 100)}%`;
      this.caption.textContent = this.mode !== 'livery' ? '' :
        `${L.set.size} operators run ${pc(L.share)} of all staked ETH. All ${L.named} named operators together run ${pc(L.namedShare)}; ` +
        `the other ${pc(1 - L.namedShare)} is solo stakers, Rocket Pool nodes, CSM operators and unattributed groups. ` +
        'Colours are brand colours where well known, otherwise one per operator.';
      return;
    }
    this.legendEl.innerHTML = '';
    for (const ct of CATS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'cat';
      b.setAttribute('aria-pressed', String(this.picked.has(ct)));
      b.innerHTML = `${sw(CAT_VAR[ct])}`; b.append(CAT_LABEL[ct]);
      b.addEventListener('click', () => { this.picked.has(ct) ? this.picked.delete(ct) : this.picked.add(ct); this.syncUrl(); this.build(); });
      this.legendEl.appendChild(b);
    }
    this.legendEl.insertAdjacentHTML('beforeend', scale);

    // caption: how far the selected destinations reach
    const sel = this.picked.size ? this.picked : new Set<Cat>(['lido']);
    const live = c.plots.map((p, i) => [p, i] as const).filter(([p]) => p.eth[k] > 0);
    const touched = live.filter(([p]) => p.mix[k].some(([a]) => sel.has(this.catOf[a])));
    const inHalf = touched.filter(([, i]) => half.has(i)).length;
    const eth = live.reduce((a, [p]) => a + p.mix[k].filter(([x]) => sel.has(this.catOf[x])).reduce((t, [, v]) => t + v, 0), 0);
    const S = c.small[s]; let ns = 0, es = 0;
    for (let i = 0; i < S.length; i += 5) if (sel.has(this.catOf[S[i + 4]])) { ns++; es += S[i + 2] ** 2 * (S[i + 3] / 1000) * 32; }
    const names = [...sel].map((x) => CAT_LABEL[x]).join(' + ');
    this.caption.textContent = `Withdraws to ${names}: ${fmt(eth + es)} ETH (${((100 * (eth + es)) / c.total[k]).toFixed(1)}% of stake), ` +
      `in ${touched.length} of ${live.length} buildings over ${c.block_eth.toLocaleString('en-US')} ETH, including ${inHalf} of the ${half.size} that together run half, ` +
      `plus ${ns.toLocaleString('en-US')} smaller ones.` + (this.picked.size ? '' : ' Click a colour to pick another destination.');
  }

  private hover(e: PointerEvent) {
    if (!this.towers) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const k = SCENARIOS.indexOf(scenario.get()), c = this.city, total = c.total[k];
    const pct = (v: number) => `${((100 * v) / total).toFixed(v / total < 0.001 ? 3 : 1)}%`;
    const hit = ray.intersectObject(this.towers)[0];
    let text = '';
    if (hit?.instanceId !== undefined) {
      const pi = this.owner[hit.instanceId], p = c.plots[pi];
      const lines = [`${p.n}: ${fmt(p.eth[k])} ETH, ${pct(p.eth[k])}`];
      if (this.mode === 'livery' && p.k === 'op') {
        const rank = 1 + c.plots.filter((q) => q.k === 'op' && q.eth[k] > p.eth[k]).length;
        lines.push(`#${rank} named operator by stake`);
      } else if (this.mode === 'nakamoto' && c.half[scenario.get()].includes(pi)) lines.push('one of the operators that together run over half');
      const mix = [...p.mix[k]].sort((a, b) => b[1] - a[1]);
      for (const [a, v] of mix.slice(0, 4)) lines.push(`  ${c.alloc_names[a]}: ${fmt(v)} (${Math.round((100 * v) / p.eth[k])}%)`);
      if (mix.length > 4) lines.push(`  and ${mix.length - 4} more`);
      text = lines.join('\n');
    } else {
      // small buildings: step down the ray from the tallest roof and take the first cell whose roof reaches it
      const S = c.small[scenario.get()], pt = new THREE.Vector3();
      let i: number | undefined;
      for (let y = STOREY * 1.4; y >= 0 && i === undefined; y -= STOREY / 16) {
        if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), pt)) break;
        const j = this.cellMap.get(Math.floor(pt.x * c.cells) * 1e6 + Math.floor(pt.z * c.cells));
        if (j !== undefined && (S[5 * j + 3] / 1000) * STOREY * (1 - SGAP) >= y) i = j;
      }
      {
        if (i !== undefined) {
          const eth = S[5 * i + 2] ** 2 * (S[5 * i + 3] / 1000) * 32, a = S[5 * i + 4];
          const who = this.catOf[a] === 'unattributed' ? 'Unattributed group (one cluster or withdrawal address)' : `Small operator, withdraws to ${c.alloc_names[a]}`;
          text = `${who}: ${fmt(eth)} ETH, about ${Math.max(1, Math.round(eth / 32))} validator${eth > 48 ? 's' : ''}`;
        }
      }
    }
    if (!text) { this.tip.hidden = true; return; }
    this.tip.textContent = text;
    this.tip.hidden = false; this.tip.style.left = `${e.clientX - r.left}px`; this.tip.style.top = `${e.clientY - r.top - 8}px`;
  }
}
customElements.define('stake-city', StakeCity);
