"""Largest operator entities at the latest frame, per scenario. usage: python -I tables.py <data dir>

Writes <data dir>/top_entities.csv and prints it as a Markdown table.
"""
import sys, pandas as pd

# Where each operator entity's parent is incorporated, and on what basis; * marks a less certain one.
# Hand-maintained. Acquired subsidiaries take their owner's country.
COUNTRY = {
    'coinbase': ('🇺🇸 US (Delaware)', 'SEC filings'),
    'kraken': ('🇺🇸 US (Delaware); HQ Wyoming', 'SEC Form D (Payward, Inc.)'),
    'bitmine': ('🇺🇸 US (Delaware)', '10-K'),
    'binance': ('🇦🇪 UAE*', 'parent Binance Holdings is Cayman-registered; global platform runs through three Abu Dhabi (ADGM) licensed entities since Jan 2026'),
    'figment': ('🇨🇦 Canada', 'company'),
    'blockdaemon': ('🇺🇸 US', 'company'),
    'everstake': ('🇰🇾 Cayman Islands*', 'company (Everstake Validation Services LLC); operations Ukraine'),
    'bitwise': ('🇺🇸 US', 'company; subsidiaries Attestant (UK) and Chorus One (Switzerland)'),
    'galaxy': ('🇺🇸 US (Delaware)', 'SEC filings'),
    'p2p': ('🇰🇾 Cayman Islands*', 'press reports; operations Cyprus'),
    'kiln': ('🇫🇷 France', 'company'),
    'etherfi': ('🇰🇾 Cayman Islands', 'company registry listing (Gadze Finance SEZC, Grand Cayman); funding releases datelined George Town'),
}
NAMES = {'kraken': 'Kraken (incl. Staked)', 'bitwise': 'Bitwise (Attestant, Chorus One)', 'bitmine': 'BitMine (MAVAN, Pier Two)',
         'p2p': 'P2P.org', 'unattributed': 'unattributed', 'liquid-collective': 'Liquid Collective', 'etherfi': 'ether.fi',
         'stakewise': 'StakeWise', 'okx': 'OKX'}

ALLOC_NAMES = {**NAMES, 'kraken': 'Kraken', 'bitmine': 'BitMine treasury', 'bitwise': 'Bitwise'}

def nice(k, names=NAMES):
    return names.get(k, k.replace('-', ' ').title())

def main():
    d = sys.argv[1]
    f = pd.read_csv(f'{d}/latest_flows.csv')
    f = f[f.entity != 'small (each <0.01%)']
    share = f.groupby(['entity', 'scenario']).share.sum().unstack().fillna(0)
    top = share.sort_values('low', ascending=False).head(10)
    rows = []
    for ent, r in top.iterrows():
        src = f[(f.scenario == 'low') & (f.entity == ent)].sort_values('share', ascending=False)
        rows.append({'entity': nice(ent), 'pessimistic': r['low'], 'central': r['cons'], 'optimistic': r['high'],
                     'largest sources (pessimistic)': ', '.join(f'{nice(a, ALLOC_NAMES)} {s:.1%}' for a, s in zip(src.alloc, src.share) if s >= 0.002),
                     'incorporated': COUNTRY.get(ent, ('unknown', ''))[0], 'basis': COUNTRY.get(ent, ('', ''))[1]})
    t = pd.DataFrame(rows)
    t.to_csv(f'{d}/top_entities.csv', index=False, float_format='%.4f')
    cols = list(t.columns)
    print('| ' + ' | '.join(cols) + ' |\n|' + '|'.join('---:' if c in ('pessimistic', 'central', 'optimistic') else '---' for c in cols) + '|')
    for r in t.itertuples(index=False):
        print('| ' + ' | '.join(f'{x:.1%}' if isinstance(x, float) else str(x) for x in r) + ' |')

if __name__ == '__main__':
    main()
