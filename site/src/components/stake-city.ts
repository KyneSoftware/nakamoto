// <stake-city>: operators as towers, small stakers as sprawl. One instanced slab per storey.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { load, scenario, SCENARIOS, type City, type Scenario } from '../data';

const STOREY = 0.55;          // storey height relative to a 1×1 tile
const GAP = 0.08;             // gap between storeys and between a plot's edge and its slab

function cssColor(el: Element, name: string) {
  return new THREE.Color(getComputedStyle(el).getPropertyValue(name).trim() || '#888');
}

class StakeCity extends HTMLElement {
  private city!: City;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);
  private controls!: OrbitControls;
  private mesh?: THREE.InstancedMesh;
  private owner: number[] = [];          // instance → plot index (-1 for sprawl)
  private tip = document.createElement('div');
  private frame = 0;

  async connectedCallback() {
    this.city = await load.city();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.appendChild(this.renderer.domElement);
    this.tip.className = 'tip'; this.tip.hidden = true; this.appendChild(this.tip);
    this.legend();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(60, 120, 40); this.scene.add(sun);

    this.camera.position.set(62, 52, 62);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 8, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false));

    new ResizeObserver(() => this.resize()).observe(this);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.renderer.domElement.addEventListener('pointerleave', () => (this.tip.hidden = true));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.build(scenario.get()));
    new MutationObserver(() => this.build(scenario.get())).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    scenario.on((s) => this.build(s));
    const tick = () => { this.frame = requestAnimationFrame(tick); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    tick();
  }

  disconnectedCallback() { cancelAnimationFrame(this.frame); this.renderer?.dispose(); }

  private resize() {
    const w = this.clientWidth, h = this.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // keep the whole city in frame: pull back on narrow (portrait) canvases
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = 150 / Math.min(1, this.camera.aspect);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
  }

  private legend() {
    const l = document.createElement('div'); l.className = 'legend';
    l.innerHTML = '<span><i style="background:var(--accent)"></i>together run over half of all stake</span>' +
      '<span><i style="background:var(--city-other)"></i>other operators</span>' +
      '<span><i style="background:var(--sprawl)"></i>solo stakers and small groups</span>';
    this.appendChild(l);
  }

  private build(s: Scenario) {
    const k = SCENARIOS.indexOf(s), c = this.city;
    const half = new Set(c.half[s]);
    const colHalf = cssColor(this, '--accent'), colOther = cssColor(this, '--city-other'), colSprawl = cssColor(this, '--sprawl');
    const nSlabs = c.plots.reduce((a, p) => a + p.h[k], 0);
    const nSprawl = Math.min(c.sprawl.count[k], c.sprawl.tiles.length / 2);

    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0.5, 0.5, 0.5);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), nSlabs + nSprawl);
    const m = new THREE.Matrix4(), owner: number[] = [];
    let i = 0;
    c.plots.forEach((p, pi) => {
      const col = half.has(pi) ? colHalf : colOther;
      for (let f = 0; f < p.h[k]; f++) {
        m.makeScale(p.w - 2 * GAP, STOREY - GAP, p.d - 2 * GAP).setPosition(p.x + GAP, f * STOREY, p.y + GAP);
        mesh.setMatrixAt(i, m); mesh.setColorAt(i, col); owner[i++] = pi;
      }
    });
    for (let t = 0; t < nSprawl; t++) {
      m.makeScale(1 - 2 * GAP, STOREY * 0.5, 1 - 2 * GAP).setPosition(c.sprawl.tiles[2 * t] + GAP, 0, c.sprawl.tiles[2 * t + 1] + GAP);
      mesh.setMatrixAt(i, m); mesh.setColorAt(i, colSprawl); owner[i++] = -1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh); this.mesh = mesh; this.owner = owner;
  }

  private hover(e: PointerEvent) {
    if (!this.mesh) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.mesh)[0];
    if (hit?.instanceId === undefined) { this.tip.hidden = true; return; }
    const k = SCENARIOS.indexOf(scenario.get()), pi = this.owner[hit.instanceId];
    const total = this.city.plots.reduce((a, p) => a + p.eth[k], 0) + this.city.sprawl.count[k] * this.city.block_eth;
    this.tip.textContent = pi < 0 ? 'Solo stakers and small groups'
      : `${this.city.plots[pi].n}: ${(this.city.plots[pi].eth[k] / 1e6).toFixed(2)}M ETH, ${((100 * this.city.plots[pi].eth[k]) / total).toFixed(1)}%`;
    this.tip.hidden = false; this.tip.style.left = `${e.clientX - r.left}px`; this.tip.style.top = `${e.clientY - r.top - 8}px`;
  }
}
customElements.define('stake-city', StakeCity);
