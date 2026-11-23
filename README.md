# nakamoto

Source for [nakamoto.kyne.eu](https://nakamoto.kyne.eu): how few node operators run half of all staked ETH.

All attributions come from [pintail's attributed validator set](https://pintail.xyz/staking/) (CC BY 4.0); this repo re-aggregates them.

- `pipeline/`: Python that fetches a pintail dataset, computes the operator Nakamoto coefficient per scenario, and exports the JSON the site reads (`python -I pipeline/export.py <dataset dir> <data dir> site/public/data`).
- `site/`: static Vite + TypeScript site with web components; the stake city uses Three.js.

```sh
cd site && npm ci && npm run dev     # or: npm run build && npm run preview
```

Code is MIT; the data in `site/public/data` derives from pintail's CC BY 4.0 dataset.
