# nakamoto

Source for [nakamoto.kyne.eu](https://nakamoto.kyne.eu): how few node operators run half of all staked ETH.

All attributions come from [pintail's attributed validator set](https://pintail.xyz/staking/) (CC BY 4.0); this repo re-aggregates them.

- `pipeline/`: Python that fetches a pintail dataset, computes the operator Nakamoto coefficient per scenario, and exports the JSON the site reads (`python -I pipeline/export.py <dataset dir> <data dir> site/public/data`).
- `site/`: static Vite + TypeScript site with web components; the stake city uses Three.js.

```sh
cd site && npm ci && npm run dev     # or: npm run build && npm run preview
```

Code is MIT; the data in `site/public/data` derives from pintail's CC BY 4.0 dataset.

## Deploy

`.github/workflows/pages.yml` rebuilds the data from pintail's latest dataset daily (and on every push to `main`), checks it with `pipeline/check.py`, and deploys `site/dist` to GitHub Pages. If any step fails, nothing is deployed and the last good site stays up. The withdrawal lens reads proxy slots for new withdrawal addresses over RPC (`ETH_RPC_URL` secret, else a public endpoint), cached between runs and seeded from `pipeline/wa_probe.seed.json.gz`.
