import assert from 'node:assert/strict';
import { probe, summarize } from './probe.mjs';

// probe: success, retry-then-success, total failure, network error
const seq = codes => { let i = 0; return async () => { const c = codes[i++]; if (c === 'ERR') throw new Error('net'); return { status: c, body: { cancel: async () => {} } }; }; };
assert.equal((await probe('x', { fetchImpl: seq([200]) })).code, 200);
assert.equal((await probe('x', { fetchImpl: seq([503, 200]) })).code, 200);
assert.equal((await probe('x', { fetchImpl: seq([503, 502]) })).code, 502);
const err = await probe('x', { fetchImpl: seq(['ERR', 'ERR']) });
assert.deepEqual([err.code, err.ms], [0, null]);

// summarize: 24h of 5-min samples with a 3-check outage 2h ago
const now = 1790000000, t = { id: 'x', name: 'X', url: 'https://x' };
const samples = [];
for (let s = now - 7 * 86400 + 300; s <= now; s += 300) {
  const down = s > now - 2 * 3600 && s <= now - 2 * 3600 + 900;
  samples.push([s, down ? null : 200 + (s % 7) * 10, down ? 0 : 200]);
}
const r = summarize(t, samples, now);
assert.equal(r.status, 'up');
assert.equal(r.checks24h, 288);
assert.equal(r.uptime24h, Math.round((285 / 288) * 10000) / 100);   // 98.96
assert.ok(r.uptime7d > 99.8 && r.uptime7d < 100);
assert.equal(r.spark.length, 24);
assert.equal(r.spark.filter(b => b.down).length, 1);                  // only the outage hour flagged
assert.equal(r.spark.at(-1).n, 12);                                   // 12 checks per hour
assert.equal(r.incidents.length, 1);
assert.equal(r.incidents[0].ongoing, false);
assert.ok(r.p50 >= 200 && r.p95 <= 260);

// ongoing outage + empty history
const down = summarize(t, [...samples.slice(0, -1), [now, null, 0]], now);
assert.equal(down.status, 'down'); assert.equal(down.incidents.at(-1).ongoing, true);
const empty = summarize(t, [], now);
assert.deepEqual([empty.status, empty.uptime24h, empty.spark.every(b => b.ms === null)], ['unknown', null, true]);
console.log('PROBE TESTS PASSED', { uptime24h: r.uptime24h, uptime7d: r.uptime7d, p50: r.p50, p95: r.p95 });
