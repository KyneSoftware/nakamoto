"""Turn the pipeline's CSVs into the compact JSON the site loads.

usage: python -I export.py <dataset dir> <data dir> <site data dir>

Writes:
  meta.json         pintail commit, epoch, date, generated time
  history.json      per-frame scenario metrics, as columns
  who.json          largest entities (shares, sources, country) and Sankey flows (top allocators/operators)
  withdrawals.json  withdrawal-control scenarios and the largest controllers
  city.json         the stake city: one plot per operator entity, laid out once; heights per scenario
"""
import sys, os, re, json, math, datetime
import numpy as np, pandas as pd

BLOCK_ETH = 2048                      # one city block
STREET = 1                            # empty tiles between plots
SMALL = 'small (each <0.01%)'
SCEN = ('low', 'cons', 'high')

def nice(k):
    from tables import nice as n       # entity display names, kept in one place
    return n(k)

def write(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{os.path.basename(path)}: {os.path.getsize(path) / 1024:.0f} KB')

def meta(ds, h):
    m = json.load(open(ds + '/manifest.json'))
    return {'pintail_commit': m['provenance']['commit'], 'through_epoch': m['through_epoch'],
            'through_time': m['through_time'], 'dataset_generated': m['generated_at'],
            'latest_frame': h.date.iloc[-1], 'eth': float(h.eth.iloc[-1]),
            'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')}

def history(h):
    keep = ['epoch', 'date', 'eth', 'op_known', 'unattributed', 'alloc_n50', 'alloc_hhi', 'alloc_gini'] + \
           [f'op_{m}_{s}' for m in ('n50', 'hhi', 'top1', 'top1_share', 'top7_share') for s in SCEN]
    out = {}
    for c in keep:
        col = h[c]
        out[c] = [round(x, 5) if isinstance(x, float) else x for x in col.tolist()]
    return out

def who(d, flows):
    top = pd.read_csv(d + '/top_entities.csv').fillna('')
    sank = {}
    for s in SCEN:
        f = flows[(flows.scenario == s) & (flows.entity != SMALL)].copy()
        ops = f.groupby('entity').eb.sum().nlargest(12).index
        als = f.groupby('alloc').eb.sum().nlargest(12).index
        f['o'] = np.where(f.entity.isin(ops), f.entity, 'other operators')
        f['a'] = np.where(f.alloc.isin(als), f.alloc, 'other allocators')
        g = f.groupby(['a', 'o']).share.sum().reset_index()
        g = g[g.share >= 0.0005]
        sank[s] = [{'a': a, 'o': o, 'v': round(v, 5)} for a, o, v in zip(g.a, g.o, g.share)]
    return {'entities': top.to_dict('records'), 'sankey': sank}

def withdrawals(d):
    w = pd.read_csv(d + '/withdrawal_control.csv')
    rows = w.to_dict('records')
    for r in rows:
        r['top'] = [{'k': k, 'v': float(v.rstrip('%')) / 100} for k, v in (x.rsplit(' ', 1) for x in r['top'].split('; '))]
    return rows

def plot_size(blocks):
    """Footprint side in tiles; grows with the fourth root, so large operators become towers."""
    return max(1, math.ceil(blocks ** 0.25 * 0.85))

UNATTR = re.compile(r'^(c:)?(0x[0-9a-f]{40}|v\d+)$')

def describe(e):
    """(kind, display name) for an operator entity key."""
    if e.startswith(('lido/3/', 'lido/5/')):
        return 'csm', f'Lido CSM operator {e.rsplit("/", 1)[1]}'
    if e.startswith('rocket-pool/node/'):
        return 'rp', f'Rocket Pool node {e.rsplit("/", 1)[1][:10]}…'
    if e.startswith('c:') and not UNATTR.match(e):
        return 'un', f'Unattributed cluster {e.rsplit("/", 1)[-1]}'
    m = UNATTR.match(e)
    if m:
        k = m.group(2)
        what = 'validator' if k.startswith('v') else ('cluster' if m.group(1) else 'withdrawal address')
        return 'un', f'Unattributed {what} {k[1:] if k.startswith("v") else k[:10] + "…"}'
    return 'op', nice(e)

def ring(R):
    pts = [(x, y) for x in range(-R + 2, R - 2) for y in range(-R + 2, R - 2)]
    return sorted(pts, key=lambda p: (p[0] ** 2 + p[1] ** 2, p))

class Ground:
    """Tile occupancy, centre outwards. Plots keep a street of STREET tiles to anything else."""
    def __init__(self, R):
        self.R, self.occ, self.ring, self.p0 = R, np.zeros((2 * R, 2 * R), bool), ring(R), 0
        self.rings, self.cur = {}, {}

    def copy(self):
        g = Ground.__new__(Ground)
        g.R, g.occ, g.ring, g.p0 = self.R, self.occ.copy(), self.ring, self.p0
        g.rings, g.cur = self.rings, dict(self.cur)
        return g

    def sectors(self, arcs):
        """arcs: {name: (a0, a1)} in radians; tiles are assigned by the angle of their centre."""
        for k, (a0, a1) in arcs.items():
            self.rings[k] = [t for t in self.ring if a0 <= math.atan2(t[1] + 0.5, t[0] + 0.5) < a1]
            self.cur[k] = 0

    def place(self, w, sector=None):
        R, occ = self.R, self.occ
        if sector is not None:
            rg = self.rings[sector]
            while self.cur[sector] < len(rg) and occ[rg[self.cur[sector]][0] + R, rg[self.cur[sector]][1] + R]:
                self.cur[sector] += 1
            cand = rg[self.cur[sector]:]
        else:
            while self.p0 < len(self.ring) and occ[self.ring[self.p0][0] + R, self.ring[self.p0][1] + R]:
                self.p0 += 1
            cand = self.ring[self.p0:]
        for x, y in cand:
            X, Y = x + R, y + R
            x0, y0, x1, y1 = X - STREET, Y - STREET, X + w + STREET, Y + w + STREET
            if x0 < 0 or y0 < 0 or x1 > 2 * R or y1 > 2 * R: continue
            if not occ[x0:x1, y0:y1].any():
                occ[X:X + w, Y:Y + w] = True
                return x, y
        raise RuntimeError('city full')

    def free_tiles(self):
        """Tiles clear of every plot and its street, centre outwards."""
        o = self.occ; d = o.copy()
        d[1:] |= o[:-1]; d[:-1] |= o[1:]; d[:, 1:] |= o[:, :-1]; d[:, :-1] |= o[:, 1:]
        d[1:, 1:] |= o[:-1, :-1]; d[:-1, :-1] |= o[1:, 1:]; d[1:, :-1] |= o[:-1, 1:]; d[:-1, 1:] |= o[1:, :-1]
        R = self.R
        for x, y in self.ring:
            if not d[x + R, y + R]:
                yield x, y

CELLS = 8              # cells per tile side: one cell-storey holds BLOCK_ETH / 64 = 32 ETH, one validator
MAX_K = CELLS - 1      # a small building plus its one-cell street fits in a tile

def small_lots(items, tiles):
    """Pack small buildings (side k cells) into free tiles, each with a one-cell street on its far sides.
    items: [(k, payload)] sorted by k descending. Returns [(cell x, cell y, payload)]."""
    out, open_tiles = [], []
    for k, pay in items:
        need = k + 1
        spot = None
        for t in open_tiles[-6:]:
            g = t[2]
            for i in range(CELLS - need + 1):
                for j in range(CELLS - need + 1):
                    if not g[i:i + need, j:j + need].any():
                        spot = (t, i, j); break
                if spot: break
            if spot: break
        if not spot:
            x, y = next(tiles)
            t = (x, y, np.zeros((CELLS, CELLS), bool)); open_tiles.append(t); spot = (t, 0, 0)
        t, i, j = spot
        t[2][i:i + need, j:j + need] = True
        out.append((t[0] * CELLS + i, t[1] * CELLS + j, pay))
    return out

# the outskirts' arcs, in order around the city
SECTORS = ['lido', 'rocket-pool', 'eigenpod', 'custody-coinbase', 'custody-other', 'exchange', 'other', 'unattributed']
DOWNTOWN = 40          # the largest operators keep the centre, whatever funds them

def group_of(a):
    if a.startswith('lido'): return 'lido'
    return a if a in SECTORS else 'other'

def city(full):
    """The stake city. Volume is stake everywhere: a plot of side w tiles and h storeys holds w*w*h*BLOCK_ETH,
    a small building of side k cells and h storeys holds k*k*h*32 ETH. Named operators keep one plot across
    scenarios; unattributed groups and everything under one block are laid out per scenario around them."""
    per = {s: full[full.scenario == s].groupby('entity').eb.sum() for s in SCEN}
    allocs = sorted(full.alloc.unique(), key=lambda a: -full[full.alloc == a].eb.sum())
    aidx = {a: i for i, a in enumerate(allocs)}
    comp = {s: full[full.scenario == s].groupby(['entity', 'alloc']).eb.sum() for s in SCEN}

    def mix(s, e):
        c = comp[s].loc[e].sort_values(ascending=False)
        return [[aidx[a], round(float(v))] for a, v in c.items() if v >= 0.5]

    ents = set().union(*[p.index for p in per.values()])
    kind = {e: describe(e) for e in ents}
    size = {e: max(float(p.get(e, 0)) for p in per.values()) for e in ents}
    shared = sorted((e for e in ents if kind[e][0] != 'un' and size[e] >= BLOCK_ETH), key=lambda e: (-size[e], e))
    total_blocks = sum(float(p.sum()) for p in per.values()) / 3 / BLOCK_ETH
    base = Ground(int(math.sqrt(total_blocks) * 1.6) + 40)

    # Downtown: the largest operators, centre outwards. Everything else sits in its source's arc, the arcs'
    # angles in proportion to the ground they need (plots count with their street).
    allcomp = full.groupby(['entity', 'alloc']).eb.sum()
    grp = {e: group_of(allcomp.loc[e].idxmax()) for e in ents}
    downtown = set(shared[:DOWNTOWN])
    # each arc is sized for the scenario where its source needs the most ground
    need = dict.fromkeys(SECTORS, 0.0)
    for s in SCEN:
        n = dict.fromkeys(SECTORS, 0.0)
        for e, v in per[s].items():
            if e in downtown or v <= 0: continue
            if float(v) >= BLOCK_ETH or e in shared:
                n[grp[e]] += (plot_size(size[e] / BLOCK_ETH) + STREET) ** 2
            else:
                n[grp[e]] += (min(MAX_K, math.ceil(math.sqrt(float(v) / 32))) + 1) ** 2 / CELLS ** 2
        need = {k: max(need[k], n[k]) for k in SECTORS}
    arcs, a0 = {}, -math.pi
    for k in SECTORS:
        a1 = a0 + 2 * math.pi * need[k] / sum(need.values())
        arcs[k] = (a0, a1 if k != SECTORS[-1] else math.pi + 1e-9)
        a0 = a1
    base.sectors(arcs)

    plots = []
    def add_plot(e, g, only=None):
        w = plot_size(size[e] / BLOCK_ETH if only is None else float(per[only][e]) / BLOCK_ETH)
        x, y = g.place(w, None if e in downtown else grp[e])
        eth = [round(float(per[s].get(e, 0))) if only in (None, s) else 0 for s in SCEN]
        plots.append({'n': kind[e][1], 'k': kind[e][0], 'x': x, 'y': y, 'w': w,
                      'h': [round(v / BLOCK_ETH / (w * w), 3) for v in eth],
                      'eth': eth, 'mix': [mix(s, e) if eth[i] else [] for i, s in enumerate(SCEN)]})

    for e in shared:
        add_plot(e, base)
    small = {}
    for s in SCEN:
        g = base.copy()
        own = sorted((e for e, v in per[s].items() if e not in shared and v >= BLOCK_ETH), key=lambda e: (-per[s][e], e))
        for e in own:
            add_plot(e, g, only=s)
        items = []
        for e, v in per[s].items():
            v = float(v)
            if e in shared or v >= BLOCK_ETH or v <= 0: continue
            k = min(MAX_K, max(1, math.ceil(math.sqrt(v / 32))))
            items.append((k, (round(v / (32 * k * k), 3), aidx[comp[s].loc[e].idxmax()], v)))
        groups = {}
        for it in items:
            groups.setdefault(group_of(allocs[it[1][1]]), []).append(it)
        free = list(g.free_tiles())
        lots = []
        for gk in sorted(groups, key=lambda x: SECTORS.index(x)):
            b0, b1 = arcs[gk]
            arc = (t for t in free if b0 <= math.atan2(t[1] + 0.5, t[0] + 0.5) < b1)
            lots += small_lots(sorted(groups[gk], key=lambda t: (-t[0], -t[1][2])), arc)
        flat = []
        for cx, cy, (h, a, v) in lots:
            k = min(MAX_K, max(1, math.ceil(math.sqrt(v / 32))))
            flat += [cx, cy, k, round(h * 1000), a]
        small[s] = flat

    # the Nakamoto set per scenario: the fewest buildings that hold over half of all stake
    half = {}
    for i, s in enumerate(SCEN):
        tot = float(per[s].sum())
        order = sorted(range(len(plots)), key=lambda j: -plots[j]['eth'][i])
        acc, ids = 0, []
        for j in order:
            acc += plots[j]['eth'][i]; ids.append(j)
            if acc > tot / 2: break
        half[s] = ids
    return {'block_eth': BLOCK_ETH, 'cells': CELLS, 'scenarios': list(SCEN), 'allocs': allocs,
            'alloc_names': [alloc_name(a) for a in allocs], 'plots': plots, 'small': small, 'half': half,
            'total': [round(float(per[s].sum())) for s in SCEN],
            'arcs': {k: [round(a, 4) for a in v] for k, v in arcs.items()}}

def alloc_name(a):
    from tables import ALLOC_NAMES
    return {'lido': 'Lido curated', 'lido-csm': 'Lido CSM', 'lido-sdvt': 'Lido Simple DVT', 'rocket-pool': 'Rocket Pool',
            'custody-coinbase': 'Coinbase custody', 'custody-other': 'BitMine at BitGo or an undisclosed custodian',
            'eigenpod': 'EigenPods', 'exchange': 'Exchanges (own staking)',
            'unattributed': 'unattributed'}.get(a) or nice_alloc(a, ALLOC_NAMES)

def nice_alloc(a, names):
    from tables import nice as n
    return n(a, names)

def main():
    ds, d, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    h = pd.read_csv(d + '/history.csv')
    flows = pd.read_csv(d + '/latest_flows.csv')
    write(out + '/meta.json', meta(ds, h))
    write(out + '/history.json', history(h))
    write(out + '/who.json', who(d, flows))
    if os.path.exists(d + '/withdrawal_control.csv'):
        write(out + '/withdrawals.json', withdrawals(d))
    write(out + '/city.json', city(pd.read_csv(d + '/latest_flows_full.csv.gz')))

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
