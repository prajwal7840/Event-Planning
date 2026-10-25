# Gather load-testing system

A separate module (nothing in `src/`, `public/` or the database schema is changed) that runs realistic, randomised, role-based load against a **throw-away copy** of the Gather API, measures it with a real load engine ([k6](https://k6.io)), and keeps every run so you can compare them.

```
 Browser ──► Console (port 5100, localhost only, token)      ← dashboard + API, never generates load
                 │ starts / cancels
                 ▼
            Worker process (one per run)                      ← lifecycle, monitoring, reports
                 ├─ provisions: throw-away DB (schema copy) + 2nd copy of the API (port 5056) with a read-only probe
                 ├─ seeds isolated test data through the real API
                 ├─ launches k6  ──────────────►  Gather API (copy)  ──►  MySQL (throw-away database)
                 └─ aggregates k6's point stream, samples CPU/memory/event loop/DB pool, writes the report
```

* **Engine:** k6 (a dedicated load tool; Gather's Express/MySQL stack needs no special integration). `loadtest/k6/*` holds the scenarios.
* **Browser tests** are separate (`npm run e2e`, Playwright); load is generated at protocol level only.
* **Storage:** JSON files in `loadtest/data/` (git-ignored). No Gather table is touched.

## Quick start

```powershell
npm run loadtest:install     # once: downloads k6 into loadtest/tools/k6 and verifies its SHA-256
npm run loadtest:smoke       # ~70 s safety check: 10 users, then look at the report path it prints
npm run loadtest             # dashboard on http://127.0.0.1:5100 (prints an access token)
npm run loadtest:test        # unit tests of this module
```

The dashboard asks for the token that the console prints when it starts (it is also stored in `loadtest/.console-token`). Every API call needs it.

CLI equivalents:

```powershell
node loadtest/cli.js --preset load --confirm managed-local
node loadtest/cli.js --config my.json --vus 200 --duration 900 --seed abc123 --confirm managed-local
node loadtest/cli.js --plan --preset stress          # show the load progression only
```

## What you can configure (no source edits)

| Setting | Meaning |
|---|---|
| Duration | **Total** time = warm-up + ramp-up + sustained load + ramp-down. Up to 30 s of *cool-down* may follow so in-flight journeys finish; it is not part of the duration. 20 s – 60 min. |
| Maximum concurrent users | Peak simulated users (1 – 1000). |
| Warm-up / ramp-up / ramp-down | Seconds for each stage. Sustained load is whatever remains; a profile that does not fit is rejected. |
| Role mix | % Hosts / Vendors / Invitees (must total 100). |
| Scenario weights | Relative weight of each journey within its role; 0 disables. |
| Think time, pacing | Random pause between a user's actions; minimum gap between a user's requests. |
| Journey length | Min/max actions per journey; chance a user leaves early. |
| Negative testing | Off by default. When on, some actions are followed by an intentionally invalid/forbidden request that is expected to be refused. |
| Thresholds | p95, p99, error rate, timeout rate, minimum sustained throughput. |
| Safety stop | Abort if the error rate stays ≥ X % for Y seconds. |
| Seed | Same seed + same settings = same per-user choices (role, journey, records, think times). |

**Users are not requests per second.** A virtual user is a simulated person who logs in once and then repeatedly performs journeys with pauses; 100 users with 1–4 s think time produce roughly 40 requests per second, not 100 simultaneous requests. Reports show both numbers.

## What users do

All journeys call real endpoints; `lib/availability.js` checks each against the routes declared in `src/routes` and marks a scenario **unavailable** (never simulated) if an endpoint is missing.

* **Host:** browse venues/offerings (random filters), manage events (list, open, create, update, delete what they created), request/edit/cancel bookings against their own events, budget and expenses, invite guests and review RSVPs, notifications.
* **Vendor:** profile/availability, list booking requests (upcoming/past) and confirm or reject pending ones for their own listings, change prices, add/remove availability slots.
* **Invitee:** list invitations (with RSVP status), open an event and its venue, accept/decline, notifications, browse listings.

Randomness (seeded, per user): role (low-discrepancy sequence so the mix holds at every concurrency level) → journey (weighted, role-eligible) → records from the pool → think times → journey length and early exits → order of independent reads. Dependent steps stay in order (events before bookings; only a booking the vendor actually received can be confirmed). Expected business refusals (409 capacity/availability conflicts, 404 races) are counted as **refusals**, not errors.

## Test data

Every run provisions `eventplanningdb_loadtest` (schema-only copy via `mysqldump --no-data`), starts a second API copy against it, seeds accounts `lt-*@loadtest.gather.test`, vendor venues/offerings with availability across 2030, events in several booking states, invitations with mixed RSVPs and expenses, runs the test, then **drops the database**. Writes during the test are bounded: each user keeps at most *N* (default 3) records it created and deletes the oldest before creating another. The provisioner refuses to use or drop the real database name.

## Metrics: collected vs not collected

| Collected (real source) | Source |
|---|---|
| Requests, successes/failures, refusals, timeouts, connection errors, status codes, latency distribution (avg, p50, p90, p95, p99, max), throughput, bytes | k6 point stream, aggregated in `lib/aggregate.js` (percentiles from a ~1 %-accurate log histogram) |
| Per-endpoint and per-scenario/role results, journeys started/completed/failed, actions per journey | k6 tags + custom metrics |
| Machine CPU/memory, k6 process CPU/memory | OS counters / process sampling every second (k6 every 5 s) |
| API process CPU, memory, event-loop lag, DB pool in use/queued, DB round-trip (`SELECT 1`) | probe preloaded into the *managed* API copy (`worker/probe-preload.js`) |

**Not collected:** MySQL server CPU/memory, per-query latency, and any server-side metric for environments without a probe. These appear as "not collected" in reports; a threshold that cannot be measured is "not measured", never "passed". CPU is reported as % of **one core** for the API (Node is single-threaded) and % of the machine for the host.

When the machine is CPU-saturated the report says so and, if the API itself was not busy, attributes the limit to the machine/load generator instead of the application.

## Reports and history

Each run stores config, seed, summary and time series. From the dashboard (Reports & history) or the API: on-screen report, **HTML**, **PDF** (rendered with local Chrome), **JSON**, and **CSV** (summary, endpoints, scenarios, time series). `Repeat` reloads the exact configuration and seed.

## Comparing runs

`Compare runs` (or `GET /api/compare?baseline=…&current=…`, or `current=` alone for the latest comparable baseline) first judges **comparability** and only then each metric.

* **Not directly comparable** (no regression/improvement is claimed; everything is "inconclusive"): different environment, either run incomplete/cancelled, max users differ by >50 %, role mix differs by >20 points, workload mix shifted >30 %, only one run used negative testing.
* **Interpret with caution:** max users differ >10 %, achieved concurrency differs >15 %, role mix >5 points, workload shift >10 %, different think time, different data-pool size, different k6 major version, a saturated load generator, or fewer than 2000 requests in either run.
* Commit, uncommitted changes and seed differences are shown as information.

Per metric (avg, p50, p90, p95, p99, error rate, timeout rate, sustained throughput, per-endpoint p95, per-scenario p95, resource use when collected in both) you get baseline, current, absolute and % difference and one of: *improvement*, *no material change*, *potential regression*, *confirmed threshold failure* (the current run breaks its own limit and the baseline did not) or *inconclusive* (not comparable / not collected). Defaults (editable per run): latency ±10 % (changes under 5 ms ignored), error rate ±0.5 points, throughput −10 %. Throughput is only judged when achieved concurrency is within 10 % and error rates within 1 point.

## Safety

* Only environments named in `config/environments.json` can be targeted; URLs are never accepted from the UI/API. `production: true` environments are rejected. The only shipped environment is `managed-local`.
* The console binds to `127.0.0.1`, checks the `Host` header, requires the access token, accepts no commands or paths, validates run ids, and allows one active run, ≤ 30 runs/hour and 5 s between runs. Limits (`config/limits.json`): ≤ 60 min, ≤ 1000 users.
* A run starts only after you type the environment name. Nothing starts automatically.
* Cancel stops k6 gracefully (partial report written); a safety stop aborts a run whose error rate stays too high. Reports never contain tokens or passwords (the per-run password is generated randomly and passed only to k6 in its environment).

## Adding a staging target

`worker/run-worker.js` supports `type: "managed"` only. To test a separate staging deployment, add an environment with `"type": "external"`, `"baseUrl"`, `"allowWrites": true` and implement its provisioning/seeding in the worker (the load generator, scenarios, reports and comparison are target-agnostic). Until then the worker refuses any other type instead of pretending.

## Layout

```
loadtest/
  console/      dashboard server + UI (public/)
  worker/       run-worker.js, provision.js, seed.js, probe-preload.js
  k6/           main.js, runtime.js, journeys.js
  shared/       prng, weights, stages, catalog, charts (used by k6, Node and the browser)
  lib/          config, availability, aggregate, histogram, monitors, thresholds, analysis, compare, report, pdf, storage
  config/       limits.json, environments.json, presets.json
  tools/        install-k6.js
  test/         unit tests (npm run loadtest:test; also picked up by npm test)
  data/         runs and profiles (git-ignored)
```

## Troubleshooting

* *"k6 is not installed"* → `npm run loadtest:install`.
* *Port 5056/5057/5100 in use* → change `appPort`/`probePort` in `config/environments.json` or `LOADTEST_PORT`.
* *`mysqldump` not found* → set `MYSQL_BIN` to the MySQL `bin` folder.
* *PDF fails* → set `CHROME_PATH`, or print the HTML report to PDF.
* Run logs: `loadtest/data/runs/<id>/run.log`; worker stdout: `worker.out`.
