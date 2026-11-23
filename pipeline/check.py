"""Refuse to publish an export that looks broken. usage: python -I check.py <site data dir>

A failed check fails the workflow before deploy, so the last good site stays up.
"""
import sys, json

d = sys.argv[1]
meta = json.load(open(d + '/meta.json'))
h = json.load(open(d + '/history.json'))
city = json.load(open(d + '/city.json'))
errors = []
known = float(h['op_known'][-1])
if known < 0.6:
    errors.append(f'named-operator coverage {known:.1%} is below 60%')
for s in ('low', 'cons', 'high'):
    n = int(h[f'op_n50_{s}'][-1])
    if not 3 <= n <= 40:
        errors.append(f'{s} Nakamoto {n} is outside 3..40')
if len(city['plots']) < 100:
    errors.append(f'only {len(city["plots"])} city plots')
# the city's scale promise: drawn volume is stake, for every building, within 2%
B, cell_eth = city['block_eth'], city['block_eth'] / city['cells'] ** 2
for k, s in enumerate(city['scenarios']):
    drawn = 0
    for p in city['plots']:
        v = p['w'] ** 2 * p['h'][k] * B
        drawn += v
        if p['eth'][k] and abs(v / p['eth'][k] - 1) > 0.02:
            errors.append(f"{s}: {p['n']} drawn {v:.0f} ETH for {p['eth'][k]}")
    sm = city['small'][s]
    for i in range(0, len(sm), 5):
        drawn += sm[i + 2] ** 2 * sm[i + 3] / 1000 * cell_eth
    if abs(drawn / city['total'][k] - 1) > 0.01:
        errors.append(f'{s}: city draws {drawn:.0f} ETH of {city["total"][k]}')
    if len(city['half'][s]) != int(h[f'op_n50_{s}'][-1]):
        errors.append(f"{s}: city half set has {len(city['half'][s])} buildings, history says {h[f'op_n50_{s}'][-1]}")
print(f"data through {meta['latest_frame']}: coverage {known:.1%}, n50 "
      + ' / '.join(str(h[f'op_n50_{s}'][-1]) for s in ('low', 'cons', 'high')))
if errors:
    raise SystemExit('refusing to publish: ' + '; '.join(errors))
