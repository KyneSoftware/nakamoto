"""Turn the pipeline's CSVs into the compact JSON the site loads.

usage: python -I export.py <dataset dir> <data dir> <site data dir>

Writes:
  meta.json         pintail commit, epoch, date, generated time
  history.json      per-frame scenario metrics, as columns
  who.json          largest entities (shares, sources, country) and Sankey flows (top allocators/operators)
  withdrawals.json  withdrawal-control scenarios and the largest controllers
  city.json         the stake city: one plot per operator entity, laid out once; heights per scenario
"""
import sys, os, json, math, datetime
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
    """Footprint grows with the square root of the square root, so large operators become towers."""
    side = max(1, math.ceil(blocks ** 0.25 * 0.85))
    return side, side

def city(flows):
    """Lay out every operator entity once, largest nearest the centre; heights per scenario."""
    per = {s: flows[flows.scenario == s].groupby('entity').eb.sum() for s in SCEN}
    allent = sorted(set().union(*[p.index for p in per.values()]) - {SMALL})
    size = {e: max(p.get(e, 0) for p in per.values()) for e in allent}
    big = [e for e in sorted(allent, key=lambda e: -size[e]) if size[e] >= BLOCK_ETH]
    # entities under one block, and the pooled small stake, become one-storey sprawl
    sprawl = {s: (per[s].get(SMALL, 0) + per[s][[e for e in per[s].index if e not in big and e != SMALL]].sum()) / BLOCK_ETH
              for s in SCEN}
    n_sprawl = int(round(max(sprawl.values())))

    R = int(math.sqrt(sum(size.values()) / BLOCK_ETH) * 1.2) + 40
    occ = np.zeros((2 * R, 2 * R), bool)
    ring = sorted(((x, y) for x in range(-R + 2, R - 2) for y in range(-R + 2, R - 2)), key=lambda p: (p[0] ** 2 + p[1] ** 2, p))

    def place(w, dpt):
        for x, y in ring:
            X, Y = x + R, y + R
            x0, x1, y0, y1 = X - STREET, X + w + STREET, Y - STREET, Y + dpt + STREET
            if x0 < 0 or y0 < 0 or x1 > 2 * R or y1 > 2 * R: continue
            if not occ[x0:x1, y0:y1].any():
                occ[X:X + w, Y:Y + dpt] = True
                return x, y
        raise RuntimeError('city full')

    plots = []
    for e in big:
        w, dpt = plot_size(size[e] / BLOCK_ETH)
        x, y = place(w, dpt)
        hts = {s: math.ceil(per[s].get(e, 0) / BLOCK_ETH / (w * dpt)) if per[s].get(e, 0) > 0 else 0 for s in SCEN}
        plots.append({'e': e, 'n': nice(e), 'x': x, 'y': y, 'w': w, 'd': dpt, 'h': [hts[s] for s in SCEN],
                      'eth': [round(float(per[s].get(e, 0))) for s in SCEN]})
    tiles = []
    for _ in range(n_sprawl):
        x, y = place(1, 1); tiles += [x, y]
    # the Nakamoto set per scenario: the fewest plots that hold over half of all stake
    total = {s: per[s].sum() for s in SCEN}
    order = {s: sorted(range(len(plots)), key=lambda i: -plots[i]['eth'][k]) for k, s in enumerate(SCEN)}
    half = {}
    for k, s in enumerate(SCEN):
        acc, ids = 0, []
        for i in order[s]:
            acc += plots[i]['eth'][k]; ids.append(i)
            if acc > total[s] / 2: break
        half[s] = ids
    return {'block_eth': BLOCK_ETH, 'scenarios': list(SCEN), 'plots': plots,
            'sprawl': {'tiles': tiles, 'count': [round(sprawl[s]) for s in SCEN]}, 'half': half}

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
    write(out + '/city.json', city(flows))

if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
