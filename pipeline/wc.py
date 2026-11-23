"""Who controls withdrawal credentials: Nakamoto, HHI and Gini at the latest snapshot.

usage: python -I wc.py <dataset dir> <wa_probe.json> <out dir>

A withdrawal credential's controller is whoever can move or upgrade what it points to:
  1. a recorded custodian (Coinbase custody, including Prime and Grayscale);
  2. every EigenPod, as one: all pods are beacon proxies upgraded by one EigenLayer owner;
  3. the allocator's organisation where it holds the keys (exchanges, treasuries, protocol vaults);
  4. other addresses sharing an upgrade beacon or proxy admin, as one per upgrader;
  5. otherwise the address itself (direct staking clients, the unattributed tail; 0x00 per validator).
Rocket Pool and Stader minipools are upgraded by each node operator's opt-in, so they are counted per
address, and again with each protocol as one.

Custody scenarios: US-listed treasury companies and ETFs hold assets with a qualified custodian. Pintail
records Coinbase custody where the chain shows it. BitMine's withdrawal wallets are held at BitGo where
pintail's decision 0087 labels them; the rest are plain addresses whose custodian the chain does not
show, so they are tried at Coinbase Custody, Anchorage Digital and BitGo in turn.

EigenPods count as one controller for HHI and Gini (one upgrade authority, one point of failure) but
under their own owners for the Nakamoto (who could act together).
"""
import sys, re, json, numpy as np, pandas as pd

ZERO = '0x' + '0' * 40
EIGENPOD_BEACON = '0x5a2a4f2f3c18f09179b6703e63d9edd165909073'
POOLED = {'custodial_staking', 'custody_staking', 'treasury_staking', 'staking_module', 'pool',
          'liquid_staking', 'liquid_restaking', 'principal_staking'}
OPT_IN_UPGRADE = {'rocket-pool/reth', 'stader/staking'}

def nakamoto(s, t=0.5):
    s = np.sort(np.asarray(s, float))[::-1]
    return int(np.searchsorted(np.cumsum(s) / s.sum(), t) + 1)

def hhi(s):
    s = np.asarray(s, float)
    return float(((s / s.sum()) ** 2).sum() * 1e4)

def gini(x):
    x = np.sort(np.asarray(x, float)); n = len(x)
    return float((2 * np.arange(1, n + 1) - n - 1) @ x / (n * x.sum()))

def controller(v, kind, probe, rp_one, merge_eigen=True):
    """Each validator's withdrawal controller. merge_eigen=False leaves each EigenPod with its own owner."""
    up = {}
    for a, p in probe.items():
        if p['codelen'] == 0: continue
        if p['beacon'] == EIGENPOD_BEACON: up[a] = 'eigenlayer'
        elif p['beacon'] != ZERO: up[a] = 'beacon:' + p['beacon']
        elif p['admin'] != ZERO: up[a] = 'proxyadmin:' + p['admin']
    up = v.withdrawal_address.map(up)
    key = v.withdrawal_address.fillna('v' + v.validator_index)
    pooled = kind.isin(POOLED) & (rp_one | ~v.allocator.isin(OPT_IN_UPGRADE))
    key[pooled] = v.organisation[pooled]
    eig = (up == 'eigenlayer') & merge_eigen
    other = up.notna() & ~pooled & (up != 'eigenlayer')
    key[other] = up[other]
    key[eig] = 'eigenlayer'
    cust = v.custodian.notna() & ~eig
    key[cust] = v.custodian[cust]
    return key

def bitgo_wallets(d):
    """BitMine withdrawal wallets that pintail's decision 0087 cites as BitGo custody wallets."""
    x = json.load(open(d + '/decisions.json'))['0087-bitmine-staking']
    urls = [s.get('url', '') for s in x.get('sources', []) + x.get('leads', []) if 'bitgo' in json.dumps(s).lower()]
    return {m.group(0).lower() for u in urls for m in [re.search(r'0x[0-9a-fA-F]{40}', u)] if m}

def main():
    d, probe_path, out = sys.argv[1:4]
    v = pd.read_csv(d + '/validators.csv.gz', dtype=str)
    eb = v.effective_balance_eth.astype(float)
    kind = v.allocator.map(pd.read_csv(d + '/entities.csv', dtype=str).set_index('entity').kind)
    probe = json.load(open(probe_path))
    bitgo = v.withdrawal_address.isin(bitgo_wallets(d)) & (v.organisation == 'bitmine')
    rest = (v.organisation == 'bitmine') & ~bitgo
    rows = []
    for rp_one, custody in ((False, 'coinbase'), (False, 'anchorage'), (False, 'bitgo'), (True, 'coinbase')):
        def keyed(merge_eigen):
            key = controller(v, kind, probe, rp_one, merge_eigen)
            key[bitgo & (key == 'bitmine')] = 'bitgo'
            key[rest & (key == 'bitmine')] = custody
            return eb.groupby(key).sum()
        # EigenPods are one point of failure (HHI, Gini), but not one party that could act (Nakamoto)
        s, parties = keyed(True), keyed(False)
        sh = (s / s.sum()).sort_values(ascending=False)
        rows.append({'minipools': 'one per protocol' if rp_one else 'one per address',
                     'bitmine_custody': 'BitGo' if custody == 'bitgo' else f'BitGo + {custody}', 'controllers': len(s),
                     'n33': nakamoto(parties, 1 / 3), 'n50': nakamoto(parties), 'n67': nakamoto(parties, 2 / 3), 'hhi': round(hhi(s)),
                     'gini': round(gini(s), 4), 'top1': round(sh.iloc[0], 4), 'top3': round(sh.head(3).sum(), 4),
                     'top10': round(sh.head(10).sum(), 4),
                     'top': '; '.join(f'{k} {x:.1%}' for k, x in sh.head(8).items())})
    r = pd.DataFrame(rows)
    r.to_csv(f'{out}/withdrawal_control.csv', index=False)
    print(r.drop(columns='top').to_string(index=False)); print(rows[0]['top'])

main()
