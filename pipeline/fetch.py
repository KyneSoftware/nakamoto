"""Download pintail's attributed validator set at a pinned commit and check it against its manifest.

usage: python -I fetch.py <out dir> [commit]

The dataset is published by pintail (https://pintail.xyz/staking/treemap/) under CC-BY-4.0 in
github.com/pintail-xyz/staking, whose history is replaced on every daily update, so an old commit
stops resolving. The default takes the latest; RESULTS_COMMIT is the one the numbers in this repo
come from (data through epoch 490,725), so pass it while it is still current to reproduce them exactly.
"""
import sys, os, json, hashlib, urllib.request

RESULTS_COMMIT = '2b115f6f694d7be42f4366d95597dc1620b0dd9f'
BASE = 'https://raw.githubusercontent.com/pintail-xyz/staking/{}/treemap/data/dataset/'

def get(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()

def main():
    out = sys.argv[1]
    ref = sys.argv[2] if len(sys.argv) > 2 else 'main'
    os.makedirs(out, exist_ok=True)
    base = BASE.format(ref)
    manifest = get(base + 'manifest.json')
    open(os.path.join(out, 'manifest.json'), 'wb').write(manifest)
    m = json.loads(manifest)
    for f in m['files']:
        body = get(base + f['name'])
        digest = hashlib.sha256(body).hexdigest()
        if digest != f['sha256']:
            raise SystemExit(f"{f['name']}: sha256 {digest} does not match manifest {f['sha256']}")
        open(os.path.join(out, f['name']), 'wb').write(body)
        print(f"{f['name']:24} {f['rows']:>10,} rows  ok")
    print(f"dataset through epoch {m['through_epoch']} ({m['through_time']}), pintail commit {m['provenance']['commit']}")

main()
