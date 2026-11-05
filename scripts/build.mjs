// Weekly build: downloads every feed in feeds/feeds.json, merges duplicates, fills in
// missing coordinates with the US Census geocoder (cached in cache/geocode.json), and
// writes the files src/aaMeetings.js reads into site/:
//   index.json, tiles/<id>.json (0.5 degree tiles), regions/<key>.json (online meetings),
//   online/<day>.json (every online meeting on that weekday, for "starting soon").
// File contents are hashed into index.json so the app knows when a cached copy is stale.
import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const UA = 'BrightDaysMeetings/1.0 (+https://github.com/netrefajaz/bright-days-meetings)';
const CELL = 0.5;
const OUT = 'site';
const GEOCODE_LIMIT = Number(process.env.GEOCODE_LIMIT || 20000); // per run
const RETRY_FAILED_DAYS = 90;

const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : null; };

const US = new Set('al ak az ar ca co ct de dc fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy pr'.split(' '));
const CA = new Set('on qc bc ab mb sk ns nb nl pe yt nt nu'.split(' '));
// Time zone to assume when a feed leaves it out (the zone most of the state uses).
const TZ = {
  'us-al':'America/Chicago','us-ak':'America/Anchorage','us-az':'America/Phoenix','us-ar':'America/Chicago','us-ca':'America/Los_Angeles',
  'us-co':'America/Denver','us-hi':'Pacific/Honolulu','us-id':'America/Boise','us-il':'America/Chicago','us-ia':'America/Chicago',
  'us-ks':'America/Chicago','us-la':'America/Chicago','us-mn':'America/Chicago','us-ms':'America/Chicago','us-mo':'America/Chicago',
  'us-mt':'America/Denver','us-ne':'America/Chicago','us-nv':'America/Los_Angeles','us-nm':'America/Denver','us-nd':'America/Chicago',
  'us-ok':'America/Chicago','us-or':'America/Los_Angeles','us-sd':'America/Chicago','us-tn':'America/Chicago','us-tx':'America/Chicago',
  'us-ut':'America/Denver','us-wa':'America/Los_Angeles','us-wi':'America/Chicago','us-wy':'America/Denver','us-pr':'America/Puerto_Rico',
  'ca-bc':'America/Vancouver','ca-ab':'America/Edmonton','ca-sk':'America/Regina','ca-mb':'America/Winnipeg','ca-on':'America/Toronto',
  'ca-qc':'America/Toronto','ca-ns':'America/Halifax','ca-nb':'America/Halifax','ca-pe':'America/Halifax','ca-nl':'America/St_Johns',
};
const tzFor = (region) => TZ[region] || (region.startsWith('us-') || region.startsWith('ca-') ? 'America/New_York' : null);

async function getJson(url, ms = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(await res.text());
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message).slice(0, 60));
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---- 1. Download ----
const feeds = await readJson('feeds/feeds.json', []);
const optout = await readJson('optout.json', { feeds: [], meetings: [] });
const config = await readJson('config.json', {});
const linkouts = await readJson('feeds/linkouts.json', []);
const blockedFeeds = new Set((optout.feeds ?? []).map(String));
const blockedMeetings = optout.meetings ?? [];

const worked = [], failed = [], raws = [];
await pool(feeds.filter((f) => !blockedFeeds.has(f.slug)), 12, async (feed) => {
  let data, err;
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    try { data = await getJson(feed.url); } catch (e) { err = e.message; }
  }
  if (!Array.isArray(data)) { failed.push(`${feed.name} (${err || 'not a list'})`); return; }
  worked.push(feed.name);
  for (const m of data) raws.push([feed, m]);
});

// ---- 2. Clean up each listing ----
function regionOf(m, feed) {
  const st = norm(m.state || m.region_state || '').replace(/ /g, '');
  const country = norm(m.country || '');
  if (US.has(st) && !country.startsWith('ca')) return `us-${st}`;
  if (CA.has(st)) return `ca-${st}`;
  return feed.region;
}

function splitAddress(m) {
  // TSML gives address, city, state, postal_code; Meeting Guide may only give formatted_address.
  if (m.address && m.city) return { street: m.address, city: m.city, state: m.state, zip: m.postal_code };
  const parts = String(m.formatted_address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const [st, zip] = parts[2].split(/\s+/);
    return { street: parts[0], city: parts[1], state: st, zip };
  }
  return null;
}

const isBlocked = (feed, m) => blockedMeetings.some((b) =>
  (!b.feed || b.feed === feed.slug) && ((b.slug && b.slug === m.slug) || (b.name && norm(b.name) === norm(m.name)) || (b.url && b.url === m.url)));

const meetings = [];
let skipped = 0;
for (const [feed, m] of raws) {
  if (!m || typeof m !== 'object' || !m.name || isBlocked(feed, m)) { skipped++; continue; }
  const types = Array.isArray(m.types) ? m.types.map(String) : [];
  if (types.includes('TC') || m.attendance_option === 'inactive') { skipped++; continue; }
  const time = /^\d{1,2}:\d{2}/.test(m.time ?? '') ? m.time.slice(0, 5).padStart(5, '0') : null;
  const days = (Array.isArray(m.day) ? m.day : [m.day]).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!time || !days.length) { skipped++; continue; }
  const region = regionOf(m, feed);
  const online = m.attendance_option === 'online';
  const hasLink = !!(m.conference_url || m.conference_phone);
  if (hasLink && !types.includes('ONL')) types.push('ONL');
  const addr = online ? null : splitAddress(m);
  const address = online ? '' : (m.formatted_address || [m.address, m.city, m.state, m.postal_code].filter(Boolean).join(', '));
  const lat = online ? null : num(m.latitude), lng = online ? null : num(m.longitude);
  for (const day of days) {
    meetings.push({
      feed: feed.slug,
      slug: String(m.slug || m.id || norm(m.name).replace(/ /g, '-')),
      name: String(m.name).trim(),
      day,
      time,
      timezone: m.timezone || tzFor(region),
      location: online ? '' : (m.location || ''),
      address,
      city: m.city || addr?.city || '',
      state: m.state || addr?.state || '',
      latitude: lat,
      longitude: lng,
      types,
      conference_url: m.conference_url || null,
      conference_phone: m.conference_phone || null,
      notes: m.conference_url_notes || m.conference_phone_notes || m.notes || null,
      url: m.url || null,
      _region: region,
      _online: online || (!address && hasLink),
      _addr: addr,
      _addrKey: addr ? norm([addr.street, addr.city, addr.state, addr.zip].join(' ')) : null,
    });
  }
}

// ---- 3. Fill in missing coordinates (US addresses only; Census covers the US) ----
const cache = await readJson('cache/geocode.json', {});
const now = Date.now();
const need = new Map();
for (const m of meetings) {
  if (m._online || m.latitude || !m._addr || !m._region.startsWith('us-') || !m._addr.street) continue;
  const hit = cache[m._addrKey];
  if (hit?.lat) continue;
  if (hit && now - hit.at < RETRY_FAILED_DAYS * 86400000) continue;
  need.set(m._addrKey, m._addr);
}
let geocoded = 0, geocodeMisses = 0, geocodeErrors = 0;
const todo = [...need.entries()].slice(0, GEOCODE_LIMIT);
const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
for (let i = 0; i < todo.length; i += 1000) {
  const batch = todo.slice(i, i + 1000);
  const csv = batch.map(([, a], k) => [k, a.street, a.city, a.state, a.zip].map(csvCell).join(',')).join('\n');
  const form = new FormData();
  form.append('benchmark', 'Public_AR_Current');
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'batch.csv');
  try {
    const res = await fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', { method: 'POST', body: form, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(600000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const found = new Map();
    for (const line of (await res.text()).split('\n')) {
      const cols = line.match(/"([^"]*)"/g)?.map((c) => c.slice(1, -1));
      if (cols?.[2] === 'Match' && cols[5]) {
        const [lng, lat] = cols[5].split(',').map(Number);
        found.set(Number(cols[0]), { lat, lng });
      }
    }
    batch.forEach(([key], k) => {
      const f = found.get(k);
      cache[key] = f ? { lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6), at: now } : { at: now };
      f ? geocoded++ : geocodeMisses++;
    });
  } catch (e) {
    geocodeErrors += batch.length;
    console.log(`Geocoder batch failed: ${e.message}`);
  }
}
let fromCache = 0;
for (const m of meetings) {
  if (m.latitude || m._online || !m._addrKey) continue;
  const hit = cache[m._addrKey];
  if (hit?.lat) { m.latitude = hit.lat; m.longitude = hit.lng; fromCache++; }
}
await mkdir('cache', { recursive: true });
await writeFile('cache/geocode.json', JSON.stringify(cache));

// ---- 4. Merge duplicates (neighboring offices often list the same group) ----
const place = (m) => (m.latitude ? `${m.latitude.toFixed(3)},${m.longitude.toFixed(3)}` : norm(m.address));
const link = (m) => norm(String(m.conference_url || '').replace(/[?#].*$/, '')) || norm(m.conference_phone);
const richness = (m) => Object.values(m).filter((v) => v && (!Array.isArray(v) || v.length)).length;
const byKey = new Map();
for (const m of meetings) {
  const key = [norm(m.name), m.day, m.time, m._online ? `online:${link(m)}` : place(m)].join('|');
  const prev = byKey.get(key);
  if (!prev || richness(m) > richness(prev)) byKey.set(key, m);
}
const merged = [...byKey.values()];

// ---- 5. Write the files ----
const clean = (m) => {
  const o = {};
  for (const [k, v] of Object.entries(m)) if (!k.startsWith('_') && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) o[k] = v;
  return o;
};
const byTime = (a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name);
await rm(OUT, { recursive: true, force: true });
for (const d of ['tiles', 'regions', 'online']) await mkdir(`${OUT}/${d}`, { recursive: true });

async function put(path, list) {
  const text = JSON.stringify(list.sort(byTime).map(clean));
  await writeFile(`${OUT}/${path}`, text);
  return hash(text);
}

const tiles = new Map(), regions = new Map(), days = Array.from({ length: 7 }, () => []);
let mapped = 0, unmapped = 0;
for (const m of merged) {
  const hasOnline = m.types.includes('ONL');
  if (!m._online && m.latitude && m.address) {
    const id = Math.floor((m.latitude + 90) / CELL) * 720 + Math.floor((m.longitude + 180) / CELL);
    if (!tiles.has(id)) tiles.set(id, []);
    tiles.get(id).push(m);
    mapped++;
  } else if (!m._online) unmapped++;
  if (hasOnline) {
    if (!regions.has(m._region)) regions.set(m._region, []);
    regions.get(m._region).push(m);
    days[m.day].push(m);
  }
}

const tileRows = [];
for (const [id, list] of [...tiles.entries()].sort((a, b) => a[0] - b[0])) {
  const h = await put(`tiles/${id}.json`, list);
  const perDay = Array.from({ length: 7 }, (_, d) => list.filter((m) => m.day === d).length);
  const row = Math.floor(id / 720), col = id % 720;
  // Regions on this tile, most meetings first (the app treats the first as "where you are").
  const counts = {};
  for (const m of list) counts[m._region] = (counts[m._region] || 0) + 1;
  const tileRegions = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  // [id, hash, total, Sun..Sat counts, center lat, center lng, ...regions] (regions start at slot 12)
  tileRows.push([id, h, list.length, ...perDay, +(row * CELL - 90 + CELL / 2).toFixed(2), +(col * CELL - 180 + CELL / 2).toFixed(2), ...tileRegions]);
}
const regionRows = [];
for (const [key, list] of [...regions.entries()].sort()) regionRows.push([key, await put(`regions/${key}.json`, list)]);
const onlineRows = [];
for (let d = 0; d < 7; d++) onlineRows.push([d, await put(`online/${d}.json`, days[d])]);

const usedFeeds = new Set(merged.map((m) => m.feed));
const index = {
  version: 1,
  generated: new Date().toISOString(),
  contact: config.contact ?? null,
  feeds: Object.fromEntries(feeds.filter((f) => usedFeeds.has(f.slug)).map((f) => [f.slug, { name: f.name, homepage: f.homepage }])),
  tiles: tileRows,
  regions: regionRows,
  online: onlineRows,
  // Offices whose lists we can't include: [name, homepage, lat, lng, miles they serve].
  linkouts: linkouts.map((o) => [o.name, o.homepage, o.lat, o.lng, o.miles]),
};
await writeFile(`${OUT}/index.json`, JSON.stringify(index));
await writeFile(`${OUT}/.nojekyll`, '');

// ---- 6. Short report ----
const onlineCount = days.reduce((s, d) => s + d.length, 0);
const report = [
  '## Meeting build',
  `Feeds worked: ${worked.length} of ${feeds.length - blockedFeeds.size}${blockedFeeds.size ? ` (${blockedFeeds.size} opted out)` : ''}.`,
  `Feeds failed (${failed.length}): ${failed.sort().join('; ') || 'none'}`,
  `Meetings: ${merged.length} after merging ${meetings.length - merged.length} duplicates (${skipped} listings skipped as closed or incomplete).`,
  `On the map: ${mapped} in ${tiles.size} tiles. In person without coordinates: ${unmapped}. Online or hybrid: ${onlineCount} across ${regions.size} regions.`,
  `Geocoded this run: ${geocoded} new addresses (${geocodeMisses} not found, ${geocodeErrors} errored, ${need.size - todo.length} left for next run). Coordinates from cache: ${fromCache - geocoded}.`,
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n');
