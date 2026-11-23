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
print(f"data through {meta['latest_frame']}: coverage {known:.1%}, n50 "
      + ' / '.join(str(h[f'op_n50_{s}'][-1]) for s in ('low', 'cons', 'high')))
if errors:
    raise SystemExit('refusing to publish: ' + '; '.join(errors))
