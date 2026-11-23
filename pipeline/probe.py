"""Read the proxy slots of every withdrawal address, to find addresses that share an upgrade key.

usage: python -I probe.py <dataset dir> <out.json> [rpc url]   (default rpc: $ETH_RPC_URL)

For each withdrawal address in validators.csv.gz it records the code length and the EIP-1967 beacon,
implementation and admin slots. wc.py uses the beacon to count all EigenPods as one controller.
Addresses already in <out.json> are kept rather than read again (proxy slots rarely change); delete
the file to read everything afresh.
"""
import sys, os, json, gzip, csv, time, urllib.request, collections

BEACON = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a2e850b55d6103'

def call(rpc, batch):
    req = urllib.request.Request(rpc, data=json.dumps(batch).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=60))

def main():
    d, out = sys.argv[1], sys.argv[2]
    rpc = sys.argv[3] if len(sys.argv) > 3 else os.environ['ETH_RPC_URL']
    with gzip.open(d + '/validators.csv.gz', 'rt') as f:
        was = sorted({r['withdrawal_address'] for r in csv.DictReader(f) if r['withdrawal_address']})
    res = json.load(open(out)) if os.path.exists(out) else {}
    res = {a: res[a] for a in was if a in res}
    todo = [a for a in was if a not in res]
    print(f'{len(was)} addresses, {len(res)} cached, reading {len(todo)}', flush=True)
    for i in range(0, len(todo), 25):
        chunk = todo[i:i + 25]; batch = []
        for j, a in enumerate(chunk):
            batch.append({'jsonrpc': '2.0', 'id': j * 4, 'method': 'eth_getCode', 'params': [a, 'latest']})
            for k, s in enumerate((BEACON, IMPL, ADMIN)):
                batch.append({'jsonrpc': '2.0', 'id': j * 4 + k + 1, 'method': 'eth_getStorageAt', 'params': [a, s, 'latest']})
        for t in range(8):
            r = {x['id']: x.get('result') for x in call(rpc, batch)}
            if all(r.get(k) is not None for k in range(len(batch))): break
            time.sleep(2 ** t)   # RPC providers rate-limit large batches
        else:
            raise SystemExit('rpc errors at %d' % i)
        for j, a in enumerate(chunk):
            code = r[j * 4]
            res[a] = {'codelen': (len(code) - 2) // 2, 'beacon': '0x' + r[j * 4 + 1][-40:],
                      'impl': '0x' + r[j * 4 + 2][-40:], 'admin': '0x' + r[j * 4 + 3][-40:]}
    json.dump(res, open(out, 'w'), sort_keys=True)
    print('addresses', len(res), 'contracts', sum(v['codelen'] > 0 for v in res.values()))
    print('beacons', collections.Counter(v['beacon'] for v in res.values()).most_common(5))

main()
