// Tests each candidate office site for a public Meeting Guide feed (the 12 Step
// Meeting List plugin serves one at /wp-admin/admin-ajax.php?action=meetings) and
// writes the ones that answer to feeds/feeds.json. Prints a short coverage report.
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const UA = 'BrightDaysMeetings/1.0 (+https://github.com/netrefajaz/bright-days-meetings)';
const TIMEOUT_MS = 30000;

// Rough populations in millions, to estimate coverage.
const POP = {
  'us-al':5.1,'us-ak':0.7,'us-az':7.4,'us-ar':3.1,'us-ca':39,'us-co':5.9,'us-ct':3.6,'us-de':1,'us-dc':0.7,
  'us-fl':22.6,'us-ga':11,'us-hi':1.4,'us-id':2,'us-il':12.5,'us-in':6.9,'us-ia':3.2,'us-ks':2.9,'us-ky':4.5,
  'us-la':4.6,'us-me':1.4,'us-md':6.2,'us-ma':7,'us-mi':10,'us-mn':5.7,'us-ms':2.9,'us-mo':6.2,'us-mt':1.1,
  'us-ne':2,'us-nv':3.2,'us-nh':1.4,'us-nj':9.3,'us-nm':2.1,'us-ny':19.6,'us-nc':10.8,'us-nd':0.8,'us-oh':11.8,
  'us-ok':4,'us-or':4.2,'us-pa':13,'us-ri':1.1,'us-sc':5.4,'us-sd':0.9,'us-tn':7.1,'us-tx':30.5,'us-ut':3.4,
  'us-vt':0.6,'us-va':8.7,'us-wa':7.8,'us-wv':1.8,'us-wi':5.9,'us-wy':0.6,'us-pr':3.2,
  'ca-on':15.6,'ca-qc':8.9,'ca-bc':5.6,'ca-ab':4.8,'ca-mb':1.5,'ca-sk':1.2,'ca-ns':1.1,'ca-nb':0.8,
  'ca-nl':0.5,'ca-pe':0.2,
};

const slugOf = (home) => new URL(home).hostname.replace(/^www\./, '').replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]+/g, '-');

async function tryFeed(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'follow' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = JSON.parse(await res.text());
    if (!Array.isArray(data)) return { error: 'not a list' };
    const real = data.filter((m) => m && typeof m === 'object' && m.name && (m.day !== undefined || m.time));
    if (!real.length) return { error: 'empty' };
    return { count: real.length, url: res.url || url };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message).slice(0, 40) };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(c) {
  const host = new URL(c.homepage).hostname;
  const bases = [c.homepage.replace(/\/$/, '')];
  if (!host.startsWith('www.')) bases.push(`https://www.${host}`);
  let last;
  for (const base of bases) {
    last = await tryFeed(`${base}/wp-admin/admin-ajax.php?action=meetings`);
    if (last.count) return { ...c, ...last };
  }
  return { ...c, error: last.error };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const lines = (await readFile('feeds/candidates.csv', 'utf8')).trim().split('\n').slice(1);
const candidates = lines.map((l) => { const [region, name, homepage] = l.split(','); return { region, name, homepage }; });
const results = await pool(candidates, 16, probe);

const ok = results.filter((r) => r.count);
const failed = results.filter((r) => !r.count);
// One entry per feed URL (two candidates can land on the same site).
const seen = new Set();
const feeds = [];
for (const r of ok) {
  const key = r.url.replace(/^https?:\/\/(www\.)?/, '');
  if (seen.has(key)) continue;
  seen.add(key);
  feeds.push({ slug: slugOf(r.homepage), region: r.region, name: r.name, homepage: r.homepage, url: r.url, meetings: r.count });
}
await writeFile('feeds/feeds.json', JSON.stringify(feeds, null, 1) + '\n');
await writeFile('feeds/probe-failed.json', JSON.stringify(failed.map(({ region, name, homepage, error }) => ({ region, name, homepage, error })), null, 1) + '\n');

const covered = new Set(feeds.map((f) => f.region));
const share = (prefix) => {
  const keys = Object.keys(POP).filter((k) => k.startsWith(prefix));
  const tot = keys.reduce((s, k) => s + POP[k], 0);
  const cov = keys.filter((k) => covered.has(k)).reduce((s, k) => s + POP[k], 0);
  return { regions: keys.filter((k) => covered.has(k)).length, of: keys.length, pct: Math.round((cov / tot) * 100) };
};
const us = share('us-'), ca = share('ca-');
const total = feeds.reduce((s, f) => s + f.meetings, 0);
const missing = Object.keys(POP).filter((k) => !covered.has(k)).join(' ');
const report = [
  '## Feed probe',
  `Candidates: ${candidates.length}. Working feeds: ${feeds.length}. Failed: ${failed.length}. Meetings listed: ${total}.`,
  `US: ${us.regions} of ${us.of} states/DC/PR have a feed (about ${us.pct}% of people live in one).`,
  `Canada: ${ca.regions} of ${ca.of} provinces (about ${ca.pct}% of people).`,
  `No feed yet: ${missing || 'none'}`,
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
