// Build-time text for readers that don't run JavaScript (crawlers, link unfurlers, LLM agents):
// fills {{TOKENS}} in index.html with today's numbers, adds JSON-LD and an inline llms.txt note,
// and emits /llms.txt and /llms-full.txt. Reads the JSON the daily pipeline wrote to public/data.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const SITE = 'https://nakamoto.kyne.eu';
const MERGE = '2022-09-15';
const DANGER = 10;
const SC = ['low', 'cons', 'high'] as const;
const NAME = { low: 'pessimistic', cons: 'central', high: 'optimistic' } as const;
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

type H = Record<string, (number | string)[]> & { date: string[] };
interface Who { entity: string; pessimistic: number; central: number; optimistic: number; 'largest sources (pessimistic)': string; incorporated: string }
interface Wd { minipools: string; bitmine_custody: string; n33: number; n50: number; top: { k: string; v: number }[] }

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const month = (d: string) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function facts(dir: string) {
  const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const h = read<H>('history.json');
  const meta = read<{ latest_frame: string; through_time: string; pintail_commit: string; eth: number; generated: string }>('meta.json');
  const who = read<{ entities: Who[] }>('who.json').entities;
  const wd = read<Wd[]>('withdrawals.json');
  const n = h.date.length - 1;
  const v = (k: string, i = n) => Number(h[k][i]);
  const range = (i: number) => {
    const xs = SC.map((s) => v(`op_n50_${s}`, i));
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return lo === hi ? `${lo}` : `${lo}–${hi}`;
  };
  const merge = h.date.findIndex((d) => d >= MERGE);
  let peak = merge;
  h.date.forEach((d, i) => { if (d >= MERGE && v('op_n50_low', i) > v('op_n50_low', peak)) peak = i; });
  let below = n + 1;                       // first frame of the current run under the danger line
  while (below > 0 && v('op_n50_low', below - 1) < DANGER) below--;
  const low = v('op_n50_low');
  return {
    h, meta, who, wd, n, v, range, merge, peak, low,
    belowSince: below <= n ? h.date[below] : null,
    tokens: {
      N50_LOW: String(low),
      N50_LOW_WORD: word(low),
      N50_LOW_CAP: cap(word(low)),
      N50_RANGE: range(n),
      N50_MERGE: range(merge),
      N50_PEAK: range(peak),
      N50_PEAK_LOW: String(v('op_n50_low', peak)),
      PEAK_MONTH: month(h.date[peak]),
      TOP7_SHARE: pct(v('op_top7_share_low')),
      KNOWN: pct(v('op_known')),
      DATE: meta.latest_frame,
      BELOW_SINCE: below <= n ? month(h.date[below]) : '',
    } as Record<string, string>,
  };
}
type Facts = ReturnType<typeof facts>;

function agentNote(f: Facts) {
  const t = f.tokens;
  return `# Operator Nakamoto (${SITE})
As of ${t.DATE}: ${t.N50_RANGE} node operators (pessimistic–optimistic scenarios) together run over half of all staked ETH; the pessimistic headline is ${t.N50_LOW}. It peaked at ${t.N50_PEAK_LOW} in ${t.PEAK_MONTH} and has been under ${DANGER} since ${t.BELOW_SINCE || 'n/a'}.
The page renders its charts with JavaScript. For plain text read ${SITE}/llms.txt (summary) or ${SITE}/llms-full.txt (method, numbers, history, data files). Raw data: ${SITE}/data/history.json, /data/city.json, /data/who.json, /data/withdrawals.json, /data/meta.json. Rebuilt daily.
Attributions are pintail's (https://pintail.xyz/staking/, CC BY 4.0), re-aggregated here; they are best effort. When citing, give the date and say which scenario.`;
}

function jsonLd(f: Facts) {
  const t = f.tokens;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#site`, url: `${SITE}/`, name: 'Operator Nakamoto',
        publisher: { '@type': 'Organization', name: 'Kyne Software' } },
      {
        '@type': 'Dataset', '@id': `${SITE}/#dataset`, name: 'Ethereum operator Nakamoto coefficient, daily',
        description: `How many node operators together run over half of all staked ETH, per scenario, from ${f.h.date[0]} to ${t.DATE}. Latest: ${t.N50_RANGE} (pessimistic ${t.N50_LOW}).`,
        url: `${SITE}/`, isAccessibleForFree: true, dateModified: f.meta.generated,
        temporalCoverage: `${f.h.date[0]}/${t.DATE}`,
        license: 'https://creativecommons.org/licenses/by/4.0/',
        creator: { '@type': 'Organization', name: 'Kyne Software' },
        isBasedOn: { '@type': 'Dataset', name: 'pintail attributed validator set', url: 'https://pintail.xyz/staking/',
          license: 'https://creativecommons.org/licenses/by/4.0/' },
        keywords: ['Ethereum', 'staking', 'Nakamoto coefficient', 'decentralisation', 'node operators', 'Lido', 'validators'],
        variableMeasured: ['operator Nakamoto coefficient (50%)', 'operator HHI', 'top-7 operator share', 'share of stake with a named operator'],
        distribution: ['history', 'city', 'who', 'withdrawals', 'meta'].map((d) => ({
          '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/data/${d}.json` })),
      },
    ],
  };
}

function llms(f: Facts) {
  const t = f.tokens;
  return `# Operator Nakamoto

> How few node operators run half of all staked ETH. As of ${t.DATE}, ${t.N50_RANGE} operators (pessimistic–optimistic) together run over half; the pessimistic headline is ${t.N50_LOW}, down from ${t.N50_PEAK_LOW} in ${t.PEAK_MONTH} and under the danger line of ${DANGER} since ${t.BELOW_SINCE || 'n/a'}. Rebuilt daily from pintail's attributed validator set (CC BY 4.0) by Kyne Software.

The number has been falling since 2024. Ethereum needs to stop that slide and turn it around; issuance cuts, post-quantum signatures and AI-driven opsec and supply-chain risk (favouring the few large firms that can afford heavy security spending) could each push it lower.

## Read
- [Full text for agents](${SITE}/llms-full.txt): method, scenarios, latest numbers, history, largest operators, data file schemas
- [The site](${SITE}/): charts (JavaScript)

## Data (JSON, updated daily)
- [history.json](${SITE}/data/history.json): one row per 4-weekly frame since genesis; columns as arrays
- [who.json](${SITE}/data/who.json): the largest operators, their share per scenario and where their stake comes from
- [withdrawals.json](${SITE}/data/withdrawals.json): who controls withdrawal credentials
- [city.json](${SITE}/data/city.json): the stake city's geometry, one building per operator or group
- [meta.json](${SITE}/data/meta.json): dataset provenance

## Optional
- [pintail staking dataset](https://pintail.xyz/staking/): the source of every attribution
- [Source code](https://github.com/KyneSoftware/nakamoto)
`;
}

function llmsFull(f: Facts) {
  const t = f.tokens, { h, v, n } = f;
  const rows = h.date.map((d, i) => i).filter((i) => h.date[i] >= '2021-06-01' && (i % 3 === 0 || i === n))
    .map((i) => `| ${h.date[i]} | ${v('op_n50_low', i)} | ${v('op_n50_cons', i)} | ${v('op_n50_high', i)} | ${pct(v('op_top7_share_low', i))} | ${pct(v('op_known', i), 0)} |`);
  const who = f.who.map((e) => `| ${e.entity} | ${pct(e.pessimistic)} | ${pct(e.central)} | ${pct(e.optimistic)} | ${e['largest sources (pessimistic)']} | ${e.incorporated} |`);
  const wd = f.wd.map((r) => `| ${r.minipools} | ${r.bitmine_custody} | ${r.n33} | ${r.n50} | ${r.top.slice(0, 4).map((x) => `${x.k} ${pct(x.v)}`).join(', ')} |`);
  return `# Operator Nakamoto: full text

Source: ${SITE}/ (Kyne Software). Data through ${t.DATE} (pintail dataset commit ${f.meta.pintail_commit.slice(0, 8)}, through ${f.meta.through_time}). Generated ${f.meta.generated}.
Every attribution is pintail's (https://pintail.xyz/staking/, CC BY 4.0); this site re-aggregates it. Attributions are best effort and may not be wholly accurate.

## Headline

- ${t.N50_RANGE} node operators (pessimistic–optimistic) together run over half of all staked ETH (${(f.meta.eth / 1e6).toFixed(2)}M ETH). Pessimistic: ${t.N50_LOW}.
- The seven largest operators run ${t.TOP7_SHARE} (pessimistic).
- At the Merge (Sep 2022) the count was ${t.N50_MERGE}. It peaked at ${t.N50_PEAK} in ${t.PEAK_MONTH}.
- Under ${DANGER} is shaded as the danger zone: a handful of firms could together stall finality (over a third of stake) or decide which history to keep (over half). The pessimistic count has been under ${DANGER} since ${t.BELOW_SINCE || 'n/a'}.
- ${t.KNOWN} of active stake has a named operator.

## Are we on the right track?

The count has fallen since early 2024. Ethereum's development should treat it as a health metric to turn around: make running validators simpler and more rewarding for independent operators than for the largest firms. Several likely changes push the other way: issuance cuts squeeze thin-margin independent operators before exchanges and custodians with other revenue; post-quantum signatures make every validator heavier to run; and AI raises operational-security and supply-chain risk, making security harder and pushing stake towards the few large firms that can afford to spend heavily on it.

## Method

An operator is whoever runs the validator keys, merged to its ultimate owner over time (e.g. Staked → Kraken, Attestant and Chorus One → Bitwise, Pier Two and MAVAN → BitMine). The operator Nakamoto coefficient is the fewest operators whose combined stake exceeds 50%.

Three scenarios differ only in how stake without a named operator is treated:

- Optimistic: an allocator's unnamed stake is run in-house; each unattributed withdrawal address is its own operator.
- Central: an allocator's unnamed stake is shared pro rata among its named operators (when at least 10% is named); BitMine's unnamed stake is on MAVAN; Grayscale is folded into Coinbase; unattributed stake is one operator per fee-recipient / withdrawal cluster.
- Pessimistic (headline): as central, but unattributed groups over 100 validators (professional scale) are shared across named operators in proportion to the stake each runs for outside clients. Most unknowns in this data hide concentration rather than independence, so the pessimistic edge is the headline.

The range spans stated assumptions, not sampling error. History is sampled every fourth weekly frame. Early frames (before mid-2022) have low operator coverage and look less concentrated than they were.

## History since June 2021 (every third frame shown; operators running over half)

| date | pessimistic | central | optimistic | top-7 share (pess.) | named-operator coverage |
|---|---|---|---|---|---|
${rows.join('\n')}

## Largest operators (share of all staked ETH)

| operator | pessimistic | central | optimistic | largest sources (pessimistic) | incorporated |
|---|---|---|---|---|---|
${who.join('\n')}

## Withdrawal-credential control

Who can withdraw the stake, under different treatments of Rocket Pool minipools and BitMine's undisclosed custodian. n33/n50: fewest controllers over a third / half.

| minipools | BitMine custody | n33 | n50 | largest |
|---|---|---|---|---|
${wd.join('\n')}

## Data files (${SITE}/data/)

- history.json: object of equal-length arrays, one entry per frame. date, epoch, eth (total staked), op_n50_{low,cons,high} (operators over half), op_hhi_*, op_top1_* (largest operator) and op_top1_share_*, op_top7_share_*, op_known (share with a named operator), unattributed (share with no allocator), alloc_n50 / alloc_hhi / alloc_gini (allocators). low = pessimistic, cons = central, high = optimistic.
- who.json: entities (largest operators, shares per scenario, sources, incorporation and its basis) and sankey (allocator → operator shares).
- withdrawals.json: rows as in the table above.
- city.json: the 3D stake city. block_eth ETH per tile-storey; plots (n name, k kind, x/y tile, w side, h storeys, eth and mix per scenario as [allocator index, ETH]); small (buildings under one block, flat arrays); allocs / alloc_names; half (plot indices that together run half); arcs.
- meta.json: pintail commit, epoch and time the data runs through, total ETH, build time.

Licence: data CC BY 4.0 (derived from pintail); code MIT (https://github.com/KyneSoftware/nakamoto). Cite as: Operator Nakamoto, Kyne Software, ${SITE}, data through ${t.DATE}, from pintail.xyz/staking.
`;
}

export function seo(dataDir: string): Plugin {
  return {
    name: 'nakamoto-seo',
    transformIndexHtml(html) {
      const f = facts(dataDir);
      const out = html.replace(/\{\{(\w+)\}\}/g, (m, k: string) => f.tokens[k] ?? m);
      return {
        html: out,
        tags: [
          { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(jsonLd(f)), injectTo: 'head' },
          { tag: 'script', attrs: { type: 'text/llms.txt' }, children: '\n' + agentNote(f) + '\n', injectTo: 'head' },
        ],
      };
    },
    generateBundle() {
      const f = facts(dataDir);
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llms(f) });
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: llmsFull(f) });
    },
  };
}
