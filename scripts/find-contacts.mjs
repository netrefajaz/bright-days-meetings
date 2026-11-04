// Visits each office whose feed is private and collects email addresses from its
// homepage and common contact pages. Writes feeds/private-contacts.json.
import { readFile, writeFile } from 'node:fs/promises';
const UA = 'BrightDaysMeetings/1.0 (+https://github.com/netrefajaz/bright-days-meetings)';
const failed = JSON.parse(await readFile('feeds/probe-failed.json', 'utf8'));
const offices = failed.filter((f) => f.error === 'HTTP 401' || f.error === 'HTTP 403');
const PAGES = ['', '/contact', '/contact-us', '/about', '/about-us', '/contact-us/', '/office'];
const skip = /(example|sentry|wixpress|wordpress|domain|yourname|email@|@2x|\.png|\.jpg)/i;
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.text() : '';
  } catch { return ''; }
}
const decodeCf = (hex) => { const k = parseInt(hex.slice(0, 2), 16); let s = ''; for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k); return s; };
const out = [];
for (const o of offices) {
  const base = o.homepage.replace(/\/$/, '');
  const host = new URL(base).hostname.replace(/^www\./, '');
  const found = new Set();
  let contactPage = null;
  for (const p of PAGES) {
    const html = await get(base + p);
    if (!html) continue;
    if (p && !contactPage) contactPage = base + p;
    const text = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, '@').replace(/&#46;|\[dot\]|\(dot\)/gi, '.');
    for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) if (!skip.test(m[0])) found.add(m[0].toLowerCase());
    for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) found.add(decodeCf(m[1]).toLowerCase());
    if (found.size >= 3) break;
  }
  // Prefer addresses on the office's own domain, then general ones.
  const emails = [...found].sort((a, b) => (b.endsWith(host) - a.endsWith(host)) || (/^(info|office|contact|webmaster|web|tech|intergroup|central)/.test(b) - /^(info|office|contact|webmaster|web|tech|intergroup|central)/.test(a)));
  out.push({ region: o.region, name: o.name, homepage: o.homepage, emails: emails.slice(0, 4), contactPage });
}
await writeFile('feeds/private-contacts.json', JSON.stringify(out, null, 1) + '\n');
const withEmail = out.filter((o) => o.emails.length).length;
console.log(`Offices: ${out.length}. With an email found: ${withEmail}. Without: ${out.length - withEmail}.`);
