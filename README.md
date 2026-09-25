# Mission Control — uptime probe

Uptime and response-time monitor behind the **Live Mission Control** telemetry on
[Rohit Rawat's portfolio](https://portfolio-gamma-nine-8uxtrereds.vercel.app/command-deck).

- `targets.json` — the production systems being watched
- `probe.mjs` — checks each target (time to response headers, one retry before counting a failure),
  keeps 7 days of samples and writes a summary: status, uptime 24h / 7d, p50 / p95 latency,
  24 hourly buckets and recent incidents
- `.github/workflows/probe.yml` — runs every 5 minutes on GitHub Actions and force-pushes the results
  as a single commit to the [`data`](../../tree/data) branch

Latest summary: [`data/summary.json`](https://raw.githubusercontent.com/rohit123-rawat/mission-control/data/summary.json)

Run locally: `node probe.mjs out` · tests: `node test.mjs`
