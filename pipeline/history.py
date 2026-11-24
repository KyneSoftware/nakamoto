"""Operator Nakamoto/HHI and allocator Gini/HHI over time, from pintail's attributed validator set.

usage: python -I history.py <dataset dir> <out dir> [--every N] [--probe wa_probe.json]

Writes <out dir>/history.csv (one row per sampled frame) and <out dir>/latest_flows.csv (stake by\nallocator and operator entity at the latest frame, per scenario; entities under 0.01% pooled).
The method, the scenarios and the column meanings are in METHOD.md.
"""
import sys, json, duckdb, numpy as np, pandas as pd

GENESIS = pd.Timestamp('2020-12-01 12:00:23')
SOLO = {'rocket-pool', 'stader'}       # unknown operator here means many solo node operators
FOLD = {'grayscale': 'coinbase'}       # stake held in Coinbase custody, run through Coinbase
MIN_KNOWN = 0.10                       # redistribute an organisation's unknown stake only above this known share
# Analyst assumptions: where an organisation's unnamed stake is run, overriding the pro-rata rule.
# BitMine's unnamed validators are taken to be on MAVAN, its own staking business (98% owned).
HINTS = {'bitmine': 'mavan'}
PRO_SCALE_ETH = 3200                   # an unattributed group above 100 validators is run professionally
# Organisations whose own-run stake is their customers' or treasury's, not outside clients'. Their own fleet
# (operator owner == organisation owner) takes no share of hidden unattributed stake in the pessimistic case.
PLATFORM_KINDS = {'exchange', 'treasury_company'}
# Lido modules shown apart in the city's "funded by" view; curated modules (lido/1, lido/4) stay 'lido'
LIDO_MODULE_TAGS = {'lido/2': 'lido-sdvt', 'lido/3': 'lido-csm', 'lido/5': 'lido-csm'}

def nakamoto(s, t=0.5):
    s = np.sort(np.asarray(s, float))[::-1]
    return int(np.searchsorted(np.cumsum(s) / s.sum(), t) + 1)

def hhi(s):
    s = np.asarray(s, float)
    return float(((s / s.sum()) ** 2).sum() * 1e4)

def gini(x):
    x = np.sort(np.asarray(x, float)); n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1) @ x / (n * x.sum()))

def epoch_of(date):
    return int((pd.Timestamp(date) - GENESIS).total_seconds() // 384)

def ownership(d):
    """owned_by decisions as {entity: [(from_epoch, owner)]}."""
    own = {}
    for k, x in json.load(open(d + '/decisions.json')).items():
        if x.get('relation') != 'owned_by' or x.get('status') != 'active': continue
        sub, owner = k.split('-owned-by-')[0][5:], k.split('-owned-by-')[1]
        own.setdefault(sub, []).append((epoch_of(x['valid_from']), owner))
    return own

def owner_at(key, e, own):
    seen = set()
    while key in own and key not in seen:
        seen.add(key)
        live = [o for f, o in own[key] if f <= e]
        if not live: break
        key = live[-1]
    return key

def box_maps(d):
    n = pd.read_parquet(d + '/nodes.parquet').set_index('node_id')
    ent = pd.read_csv(d + '/entities.csv', dtype=str).set_index('entity')
    v = pd.read_csv(d + '/validators.csv.gz', dtype=str)
    op_org = v.dropna(subset=['operator']).drop_duplicates('operator').set_index('operator').operator_organisation
    org, op, raw = {}, {}, {}
    for nid in n.index[n.is_leaf]:
        o = p = None; cur = nid
        while cur is not None and not pd.isna(cur):
            r = n.loc[cur]
            if p is None and r.kind == 'node_operator' and isinstance(r.entity, str):
                p = op_org.get(r.entity) if isinstance(op_org.get(r.entity), str) else r.entity
                raw[nid] = r.entity
            if o is None and r.kind not in ('node_operator', 'operator_group') and isinstance(r.entity, str) and r.entity in ent.index:
                o = ent.organisation[r.entity]
            if str(r.path).startswith('Unattributed'): o = None; break
            cur = r.parent_id
        org[nid], op[nid] = o, p
    # operators the latest snapshot knows per validator (e.g. BitMine's by graffiti), keyed by (validator, box)
    cur = v.dropna(subset=['operator'])
    vop = {(int(i), int(b)): (oo if isinstance(oo, str) else o) for i, b, oo, o in
           zip(cur.validator_index, cur.box_id, cur.operator_organisation, cur.operator)}
    return org, op, raw, vop

def categories(d, probe_path=None):
    """{validator index: display category} for the stake city's "funded by" view, from the latest snapshot.
    Display only: every metric groups by operator entity, never by category.

    Lido's modules (curated, Simple DVT, CSM) and Rocket Pool by allocator; then custody: Coinbase (pintail's Coinbase
    custody attributions plus Coinbase's own staking), and BitMine's stake, at BitGo where pintail's decision 0087 cites the wallet, else at a
    custodian BitMine has not disclosed per wallet; then EigenPod withdrawal addresses (needs probe.py output);
    then exchanges' own staking (organisation kind 'exchange'). Earlier in that list wins."""
    import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from wc import bitgo_wallets, EIGENPOD_BEACON
    v = pd.read_csv(d + '/validators.csv.gz', dtype=str,
                    usecols=['validator_index', 'organisation', 'allocator', 'custodian', 'withdrawal_address'])
    cat = pd.Series(pd.NA, index=v.index, dtype=object)
    cat[v.organisation.map(org_kinds(d)) == 'exchange'] = 'exchange'
    if probe_path:
        probe = json.load(open(probe_path))
        pods = {a for a, p in probe.items() if p['codelen'] and p['beacon'] == EIGENPOD_BEACON}
        cat[v.withdrawal_address.isin(pods)] = 'eigenpod'
    bm = v.organisation == 'bitmine'
    cat[bm] = 'custody-other'
    cat[v.custodian == 'coinbase'] = 'custody-coinbase'
    cat[v.organisation == 'coinbase'] = 'custody-coinbase'   # Coinbase's own staking joins its custody: one colour
    cat[v.organisation == 'rocket-pool'] = 'rocket-pool'
    lido = v.organisation == 'lido'
    cat[lido] = v.allocator[lido].map(LIDO_MODULE_TAGS).fillna('lido')
    v = v[cat.notna()]
    return pd.Series(cat[cat.notna()].values, index=v.validator_index.astype(int))

def load(c, e, org, op, raw, vop, cats=None):
    """Active validators at epoch e with their organisation, operator and fallback keys."""
    df = c.sql(f"""
      select a.validator_index vi, a.node_id, s.effective_balance_eth::double eb,
             coalesce(a.withdrawal_address, 'v' || a.validator_index) wa,
             a.reward_cluster rc, a.withdrawal_cluster wc
      from att a join stk s using (validator_index)
      where a.from_epoch <= {e} and (a.to_epoch is null or a.to_epoch > {e})
        and s.from_epoch <= {e} and (s.to_epoch is null or s.to_epoch > {e})""").df()
    df['org'] = df.node_id.map(org)
    df['op'] = df.node_id.map(op)
    df['op_id'] = df.node_id.map(raw)
    miss = df.op.isna() & df.org.notna()
    df.loc[miss, 'op'] = [vop.get((i, b)) for i, b in zip(df.vi[miss], df.node_id[miss])]
    df['clustered'] = 'c:' + df.rc.fillna(df.wc).fillna(df.wa)
    df['cat'] = df.org.fillna('unattributed')
    if cats is not None:
        m = df.vi.map(cats)
        df.loc[m.notna(), 'cat'] = m[m.notna()]
    return df

SCENARIOS = ('high', 'cons', 'low')

def org_kinds(d):
    """{organisation: kind} from entities.csv."""
    ent = pd.read_csv(d + '/entities.csv', dtype=str)
    return ent[ent.entity == ent.organisation].set_index('entity').kind.to_dict()

def spread_pool(df, e, own, kinds):
    """Each named operator's client book, by owner: the weights for spreading hidden unattributed stake.

    Left out: solo node operators (Rocket Pool, Stader), and an exchange's or treasury company's own
    fleet running its own stake (Coinbase for Coinbase, MAVAN for BitMine). Neither takes on outside
    clients through that stake. The same operator's stake for other organisations still counts."""
    k = df[df.op.notna() & ~df.org.isin(SOLO)]
    ent = k.op.map(lambda x: owner_at(x, e, own))
    org = k.org.map(lambda x: owner_at(x, e, own) if isinstance(x, str) else None)
    in_house = (ent == org) & k.org.map(kinds).isin(PLATFORM_KINDS)
    return k.eb[~in_house].groupby(ent[~in_house]).sum()

def flows(df, e, own, sc, kinds):
    """Stake by (allocator, operator entity) under one scenario: high, cons or low (METHOD.md)."""
    # cat is a display category riding along (the stake city's "funded by"); no rule here reads it
    alloc = df.org.fillna('unattributed')
    unk = df.op.isna() & df.org.notna() & ~df.org.isin(SOLO)
    tail = df.op.isna() & ~unk
    tail_key = df.wa if sc == 'high' else df.clustered
    kn_ = df.op.notna()
    parts = [pd.DataFrame({'alloc': alloc[kn_], 'cat': df.cat[kn_], 'entity': df.op[kn_], 'eb': df.eb[kn_]}),
             pd.DataFrame({'alloc': alloc[tail], 'cat': df.cat[tail], 'entity': tail_key[tail], 'eb': df.eb[tail]})]
    for (o, ct), amt in df[unk].groupby(['org', 'cat']).eb.sum().items():
        to = o
        if sc != 'high':
            to = FOLD.get(o, o)
            kn = df[(df.org == to) & df.op.notna()].groupby('op').eb.sum()
            if to in HINTS:
                to = HINTS[to]
            elif kn.sum() >= MIN_KNOWN * df.eb[df.org == to].sum():
                parts.append(pd.DataFrame({'alloc': o, 'cat': ct, 'entity': kn.index, 'eb': amt * kn.values / kn.sum()})); continue
        parts.append(pd.DataFrame({'alloc': [o], 'cat': [ct], 'entity': [to], 'eb': [amt]}))   # run in-house, or per the hint
    f = pd.concat(parts, ignore_index=True).groupby(['alloc', 'cat', 'entity'], as_index=False).eb.sum()
    if sc == 'low':
        un = f.alloc == 'unattributed'
        big = un & (f.eb.where(un, 0).groupby(f.entity).transform('sum') > PRO_SCALE_ETH)
        named = spread_pool(df, e, own, kinds)
        spread = pd.concat([pd.DataFrame({'alloc': 'unattributed', 'cat': ct, 'entity': named.index, 'eb': amt * named.values / named.sum()})
                            for ct, amt in f[big].groupby('cat').eb.sum().items()] or [f.iloc[:0]], ignore_index=True)
        f = pd.concat([f[~big], spread], ignore_index=True)
    f['entity'] = [owner_at(k, e, own) for k in f.entity]
    return f.groupby(['alloc', 'cat', 'entity'], as_index=False).eb.sum()

def score(df, e, own, kinds, top=None):
    """The frame's metrics; with top, also fills in its flows per scenario."""
    T = df.eb.sum()
    out = {'epoch': e, 'date': (GENESIS + pd.Timedelta(seconds=384 * e)).date().isoformat(), 'eth': T,
           'op_known': df.eb[df.op.notna()].sum() / T, 'unattributed': df.eb[df.org.isna()].sum() / T}

    # allocator lens: organisation, else the unattributed validator's cluster
    a = df.eb.groupby(df.org.where(df.org.notna(), df.clustered)).sum()
    out.update(alloc_n50=nakamoto(a), alloc_hhi=hhi(a), alloc_gini=gini(a))

    # operator lens
    for sc in SCENARIOS:
        f = flows(df, e, own, sc, kinds)
        s = f.groupby('entity').eb.sum()
        out[f'op_n50_{sc}'], out[f'op_hhi_{sc}'] = nakamoto(s), hhi(s)
        sh = (s / T).sort_values(ascending=False)
        out[f'op_top1_{sc}'], out[f'op_top1_share_{sc}'] = sh.index[0], sh.iloc[0]
        out[f'op_top7_share_{sc}'] = sh.head(7).sum()
        if top is not None: top[sc] = f

    # drivers
    out['lido'] = df.eb[df.org == 'lido'].sum() / T
    out['bitmine'] = df.eb[df.org == 'bitmine'].sum() / T
    out['unknown_inhouse'] = df.eb[df.op.isna() & df.org.notna() & ~df.org.isin(SOLO)].sum() / T
    unattr = df[df.org.isna()].groupby('clustered').eb.sum()
    out['unattributed_pro_scale'] = unattr[unattr > PRO_SCALE_ETH].sum() / T
    return out

def main():
    d, dst = sys.argv[1], sys.argv[2]
    every = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 4
    probe = sys.argv[sys.argv.index('--probe') + 1] if '--probe' in sys.argv else None
    c = duckdb.connect()
    c.sql(f"create table att as select * from '{d}/attributions.parquet'")
    c.sql(f"create table stk as select * from '{d}/stake.parquet'")
    epochs = [r[0] for r in c.sql(f"select distinct epoch from '{d}/treemap.parquet' order by 1").fetchall()]
    pick = [e for e in sorted(set(epochs[::every] + [epochs[-1]])) if e > 0]
    org, op, raw, vop = box_maps(d)
    cats = categories(d, probe)
    own, kinds = ownership(d), org_kinds(d)
    rows, top = [], {}
    for e in pick:
        last = e == pick[-1]
        rows.append(score(load(c, e, org, op, raw, vop, cats if last else None), e, own, kinds, top if last else None))
        r = rows[-1]
        print(r['date'], 'n50 high/cons/low', r['op_n50_high'], r['op_n50_cons'], r['op_n50_low'], flush=True)
    pd.DataFrame(rows).to_csv(f'{dst}/history.csv', index=False, float_format='%.6g')
    f = pd.concat([top[sc].assign(scenario=sc) for sc in SCENARIOS])
    # unpooled, by display category: one row per (category, operator entity), for the stake city
    full = f.groupby(['scenario', 'cat', 'entity'], as_index=False).eb.sum().rename(columns={'cat': 'alloc'})
    full.to_csv(f'{dst}/latest_flows_full.csv.gz', index=False, float_format='%.6g')
    f = f.groupby(['scenario', 'alloc', 'entity'], as_index=False).eb.sum()
    f['share'] = f.eb / f.groupby('scenario').eb.transform('sum')
    # entities under 0.01% of stake (solo stakers, small groups) are pooled per allocator
    small = f.groupby(['scenario', 'entity']).share.transform('sum') < 1e-4
    f.loc[small, 'entity'] = 'small (each <0.01%)'
    f = f.groupby(['scenario', 'alloc', 'entity'], as_index=False)[['eb', 'share']].sum()
    f.sort_values(['scenario', 'share'], ascending=[True, False]).to_csv(f'{dst}/latest_flows.csv', index=False, float_format='%.6g')

if __name__ == '__main__':
    main()
