// Uptime probe for Rohit Rawat's portfolio (Live Mission Control).
// Checks each target in targets.json, appends a sample to data/status.json
// (rolling 7 days) and writes data/summary.json, which the portfolio reads.
//   node probe.mjs [dataDir]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const RETENTION_S = 7 * 86400;
const TIMEOUT_MS = 15000;
const UA = 'rohit123-rawat/mission-control uptime probe (+https://github.com/rohit123-rawat/mission-control)';

const isUp = code => code >= 200 && code < 400;

// One check: time until response headers arrive. Retries once so a single
// network blip from the runner isn't recorded as downtime.
export async function probe(url, { attempts = 2, fetchImpl = fetch } = {}) {
  let last = { ms: null, code: 0 };
  for (let i = 0; i < attempts; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const t0 = performance.now();
    try {
      const res = await fetchImpl(url, { redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' } });
      const ms = Math.round(performance.now() - t0);
      res.body?.cancel?.().catch(() => {});
      last = { ms, code: res.status };
    } catch {
      last = { ms: null, code: 0 };
    } finally {
      clearTimeout(timer);
    }
    if (isUp(last.code)) return last;
    if (i < attempts - 1) await new Promise(r => setTimeout(r, 3000));
  }
  return last;
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const uptime = samples => (samples.length ? Math.round(samples.filter(s => isUp(s[2])).length / samples.length * 10000) / 100 : null);

// samples: [[epochSeconds, ms|null, httpCode], ...] oldest first
export function summarize(target, samples, nowS) {
  const last = samples.at(-1);
  const day = samples.filter(s => s[0] > nowS - 86400);
  const okMs = day.filter(s => isUp(s[2]) && s[1] != null).map(s => s[1]);

  // 24 hourly buckets, oldest → newest: median latency + whether any check failed
  const spark = Array.from({ length: 24 }, (_, i) => {
    const from = nowS - (24 - i) * 3600, to = from + 3600;
    const b = samples.filter(s => s[0] > from && s[0] <= to);
    return { ms: median(b.filter(s => isUp(s[2]) && s[1] != null).map(s => s[1])), down: b.some(s => !isUp(s[2])), n: b.length };
  });

  // Incidents: consecutive failed checks, last 7 days
  const incidents = [];
  let open = null;
  for (const s of samples) {
    if (!isUp(s[2])) { if (!open) open = { start: s[0], end: s[0], code: s[2] }; else open.end = s[0]; }
    else if (open) { open.end = s[0]; incidents.push(open); open = null; }
  }
  if (open) incidents.push({ ...open, ongoing: true });

  return {
    id: target.id,
    name: target.name,
    url: target.url,
    status: last ? (isUp(last[2]) ? 'up' : 'down') : 'unknown',
    code: last ? last[2] : null,
    latency: last ? last[1] : null,
    checkedAt: last ? new Date(last[0] * 1000).toISOString() : null,
    since: samples.length ? new Date(samples[0][0] * 1000).toISOString() : null,
    checks24h: day.length,
    uptime24h: uptime(day),
    uptime7d: uptime(samples),
    p50: median(okMs),
    p95: pct(okMs, 0.95),
    spark,
    incidents: incidents.slice(-5).map(x => ({
      start: new Date(x.start * 1000).toISOString(),
      end: new Date(x.end * 1000).toISOString(),
      code: x.code,
      ongoing: !!x.ongoing,
    })),
  };
}

async function main() {
  const dir = process.argv[2] || 'data';
  mkdirSync(dir, { recursive: true });
  const targets = JSON.parse(readFileSync(new URL('./targets.json', import.meta.url), 'utf8'));
  const file = join(dir, 'status.json');
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { v: 1, targets: {} };
  const nowS = Math.floor(Date.now() / 1000);
  const probeLabel = process.env.GITHUB_ACTIONS ? `GitHub Actions (${process.env.RUNNER_OS || 'Linux'})` : 'manual run';

  const results = await Promise.all(targets.map(t => probe(t.url)));
  targets.forEach((t, i) => {
    const entry = (state.targets[t.id] ||= { samples: [] });
    entry.name = t.name;
    entry.url = t.url;
    entry.samples.push([nowS, results[i].ms, results[i].code]);
    entry.samples = entry.samples.filter(s => s[0] > nowS - RETENTION_S);
    console.log(`${t.id.padEnd(14)} ${results[i].code || 'ERR'} ${results[i].ms ?? '—'} ms`);
  });
  for (const id of Object.keys(state.targets)) if (!targets.some(t => t.id === id)) delete state.targets[id];

  state.updated = new Date(nowS * 1000).toISOString();
  state.probe = probeLabel;
  writeFileSync(file, JSON.stringify(state));
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({
    v: 1,
    updated: state.updated,
    probe: probeLabel,
    intervalMin: 5,
    targets: targets.map(t => summarize(t, state.targets[t.id].samples, nowS)),
  }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
