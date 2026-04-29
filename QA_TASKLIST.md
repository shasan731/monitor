# QA Tasklist — Monitor

A senior-QA review of the Monitor codebase as of 2026-04-28. Items are grouped
by domain and prioritized: **P0** = blocker / data-loss / security, **P1** =
broken feature or incorrect behavior, **P2** = improvement / polish.

Each item references the file(s) involved so an engineer can jump straight in.

---

## 🚨 P0 — Critical / Blockers

### Backend / Database

- [ ] **Schema does not match what `/api/ingest` writes — every metric insert will fail.**
  [supabase/migrations/20260427000000_initial_schema.sql:37-44](supabase/migrations/20260427000000_initial_schema.sql#L37-L44) declares `metrics` with only `cpu_usage`, `ram_usage`, `disk_usage`, `created_at`. The ingest handler at
  [src/app/api/ingest/route.ts:94-106](src/app/api/ingest/route.ts#L94-L106)
  writes `process_count`, `top_cpu_processes`, `top_ram_processes`, `interfaces`,
  `ping_latency_ms`, `ping_loss_pct`, `ping_target` — none of which exist in
  the table. PostgREST will reject every payload with "column not found".
  Fix: add the missing columns to the migration (numeric, JSONB, JSONB, JSONB,
  real, real, text) and re-run.

- [ ] **`public_metrics` view missing process/network fields.**
  [supabase/migrations/20260427000000_initial_schema.sql:188-193](supabase/migrations/20260427000000_initial_schema.sql#L188-L193).
  Once the columns are added (above), decide whether the public status page
  should expose them. Today the public page only shows CPU/RAM/Disk (correct),
  but if you ever consume more in `public_metrics`, update the view + grants.

- [ ] **`/api/commands/[id]/result` can crash on truncation.**
  [src/app/api/commands/[id]/result/route.ts:60-62](src/app/api/commands/[id]/result/route.ts#L60-L62).
  `JSON.parse(JSON.stringify(body.result).slice(0, 200_000))` — if the slice
  cuts mid-token, `JSON.parse` throws and the route 500s without a clean error.
  Fix: cap by validating size on the stringified copy and store as-is, or wrap
  the parse in a try/catch that falls back to `null`.

- [ ] **`createAdminClient` uses CommonJS `require()` inside an ESM/TS module.**
  [src/lib/supabase/server.ts:29-36](src/lib/supabase/server.ts#L29-L36).
  Works under Next's runtime but is fragile against bundling changes and
  defeats tree-shaking. Convert to a top-level `import` and lazily instantiate
  the client.

- [ ] **`SUPABASE_SERVICE_ROLE_KEY` not validated at boot.**
  [src/lib/supabase/server.ts:33](src/lib/supabase/server.ts#L33). The `!`
  non-null assertion silently lets the route proceed with `undefined`,
  producing a confusing 401/500 from PostgREST. Add an explicit env-var check
  on first use that throws a clear error.

### Agent — Windows

- [ ] **`tracert.exe -- $Target` is invalid.**
  [scripts/windows-agent.ps1:164](scripts/windows-agent.ps1#L164). `tracert.exe`
  does not recognise the `--` end-of-options sentinel; it will treat `--` as
  the destination and the actual target as a junk arg, returning "Unable to
  resolve target system name --." Fix: drop `--` and rely on PowerShell's
  argument quoting (the regex-validated target makes injection impossible
  anyway).

- [ ] **`Get-TopProcesses` `$prevCpu` map grows unbounded.**
  [scripts/windows-agent.ps1:78-86](scripts/windows-agent.ps1#L78-L86). Process
  IDs of dead processes are never evicted, so the hashtable grows for the
  life of the agent. Over weeks this is a real memory leak in a long-running
  service. Fix: rebuild `$prevCpu` from the current iteration's PIDs each tick.

### Agent — macOS

- [ ] **`launchctl bootout` argument is wrong.**
  [scripts/macos-agent.sh:331](scripts/macos-agent.sh#L331). The modern
  `bootout` syntax is `launchctl bootout system/<label>` (or `bootout system
  /Library/LaunchDaemons/x.plist` works in some versions, but the safer form
  is the service spec). On older macOS this can silently fail to remove the
  prior daemon, leaving two copies running after re-install. Fix: `launchctl
  bootout system/com.monitor.agent 2>/dev/null || true`.

---

## 🔴 P1 — Broken Behavior / Bugs

### Backend / API

- [ ] **`/api/install/[host_id]` does not validate UUID shape.**
  [src/app/api/install/[host_id]/route.ts:23-27](src/app/api/install/%5Bhost_id%5D/route.ts#L23-L27). A
  malformed `host_id` is forwarded to Postgres, causing a 22P02 error. Today
  the catch-all returns a 404 message but the underlying call still throws.
  Add a regex check before querying.

- [ ] **`/api/commands/pending` does not validate `host_id` UUID either.**
  [src/app/api/commands/pending/route.ts:26-30](src/app/api/commands/pending/route.ts#L26-L30).
  Same risk as above.

- [ ] **`/api/ingest` — `process_count` is never clamped to a sane range.**
  [src/app/api/ingest/route.ts:99](src/app/api/ingest/route.ts#L99). A rogue
  agent could send `2_000_000_000` and inflate the JSONB cell. Cap at, e.g.,
  100k.

- [ ] **`auth/callback` redirects to `/dashboard` even when code exchange fails.**
  [src/app/auth/callback/route.ts:7-11](src/app/auth/callback/route.ts#L7-L11).
  The middleware will then bounce the user back to `/login` with no message
  about why. Surface the error and redirect to `/login?error=<msg>`.

- [ ] **Public-token does not rotate when sharing is disabled then re-enabled.**
  [src/components/PublicShareToggle.tsx:27-32](src/components/PublicShareToggle.tsx#L27-L32) +
  [supabase/migrations/20260427000000_initial_schema.sql:22](supabase/migrations/20260427000000_initial_schema.sql#L22).
  Anyone who saw the share URL keeps access if you re-enable later. Fix:
  rotate `public_token = encode(gen_random_bytes(18), 'hex')` whenever
  `is_public` flips from true→false (or any time the user explicitly clicks
  "rotate token").

- [ ] **`sw.js` returns the cached `/dashboard` HTML as a fallback for any failed GET.**
  [public/sw.js:30](public/sw.js#L30). If a logged-out user opens `/login`
  while offline, they get the (stale, authenticated) dashboard shell. Use a
  dedicated `/offline` page or scope the fallback to dashboard URLs only.

- [ ] **Service worker cache key (`monitor-v1`) is never bumped.**
  [public/sw.js:1](public/sw.js#L1). Once installed, the SW serves stale HTML
  forever. Either bump the constant on each release, or move to a build-time
  hash.

- [ ] **CORS `Access-Control-Allow-Origin: *` on `/api/ingest` is unnecessary.**
  [src/app/api/ingest/route.ts:7-11](src/app/api/ingest/route.ts#L7-L11).
  Agents call it server-to-server; no browser ever needs CORS. Remove the
  headers (defence in depth — narrows blast radius if api_key leaks).

### Frontend / UI

- [ ] **`Sparkline` always scales to 0–100, hiding low-volatility data.**
  [src/components/Sparkline.tsx:22-26](src/components/Sparkline.tsx#L22-L26).
  Disk usage that's flat at 65% looks identical to flat at 5%. Auto-scale
  to min/max of the data (with a small headroom) for sparklines, or add an
  explicit `min/max` prop.

- [ ] **`HostsBrowser` flickers from grid → list on first render.**
  [src/components/HostsBrowser.tsx:21-28](src/components/HostsBrowser.tsx#L21-L28).
  Default state is `"grid"`; the saved preference is read in `useEffect`,
  so list-preferring users see grid for one frame. Fix: read the preference
  in a `useState` lazy initialiser guarded by `typeof window !== "undefined"`,
  or store the preference as a cookie so SSR can pick it up.

- [ ] **`AddHostDialog` accepts whitespace-only host names.**
  [src/components/AddHostDialog.tsx:38](src/components/AddHostDialog.tsx#L38).
  `required` only enforces non-empty; trim and re-validate before insert.

- [ ] **`HostMenu` rename: same problem and no length cap.**
  [src/components/HostMenu.tsx:38-47](src/components/HostMenu.tsx#L38-L47).
  Trim and enforce a max length (e.g. 64 chars) — `hosts.name` is `text` with
  no constraint today.

- [ ] **`PushOptIn` doesn't surface backend failure.**
  [src/components/PushOptIn.tsx:44-49](src/components/PushOptIn.tsx#L44-L49).
  If `POST /api/push/subscribe` fails, the UI says "Bell — enabled" but the
  server has no row, so no pushes will ever arrive. Check the response, show
  an error, and roll back local state on failure.

- [ ] **`PushOptIn` doesn't handle the "permission denied" path.**
  [src/components/PushOptIn.tsx:37-38](src/components/PushOptIn.tsx#L37-L38).
  Returns silently when the user denies — no toast, no message. Show a
  message explaining how to re-grant permission.

- [ ] **`MetricChart` SVG uses `preserveAspectRatio="none"`.**
  [src/components/MetricChart.tsx:100](src/components/MetricChart.tsx#L100).
  At narrow widths, the line and the latest dot stretch / squash, making
  values look fatter or thinner than they are. Use the default
  `preserveAspectRatio` and add a fixed `height` instead.

- [ ] **`HostDetailClient` realtime UPDATE can over-write authoritative fields.**
  [src/components/HostDetailClient.tsx:39](src/components/HostDetailClient.tsx#L39).
  A partial payload (e.g. when only `last_beat` changed) clobbers `prev` with
  spread but Supabase Realtime sends full `new` rows, so this is usually fine
  — except DELETE events return `old` not `new` and the early-return guard
  is correct. Add a unit test for that branch so the assumption stays true.

- [ ] **`TracerouteCard` keeps the previous result on the screen when "Run" is clicked again.**
  [src/components/TracerouteCard.tsx:71-80](src/components/TracerouteCard.tsx#L71-L80).
  After insert, `setActive(data)` swaps in the new row but the OLD subscription
  channel is still open until the effect re-runs. There's a moment where the
  *old* channel is still receiving updates for a stale id while UI shows the
  new row. Effects deps `[active?.id]` will re-fire correctly — verify with
  a quick test, but consider explicitly closing the prior channel before
  inserting.

- [ ] **`HostDetailClient` API key reveal — no copy mask after re-show.**
  [src/components/HostDetailClient.tsx:121-131](src/components/HostDetailClient.tsx#L121-L131).
  Once revealed, the key stays in the DOM until navigation. Auto-hide after
  ~30s as a small hardening.

- [ ] **Sign-up: `minLength={6}` is too weak.**
  [src/app/signup/page.tsx:58](src/app/signup/page.tsx#L58). Match Supabase
  Auth defaults (≥8 chars) and ideally require non-trivial complexity, or
  rely on Supabase's password policy if you've configured one.

- [ ] **Login/Signup do not disable the email field while loading.**
  [src/app/login/page.tsx:44](src/app/login/page.tsx#L44),
  [src/app/signup/page.tsx:54](src/app/signup/page.tsx#L54). Users can
  edit fields mid-submit; the second submission uses stale state. Either
  disable inputs or guard against double-submit.

- [ ] **Form has no client-side rate-limit / second-submit guard.**
  [src/app/login/page.tsx:19-28](src/app/login/page.tsx#L19-L28). Pressing
  Enter fast can fire two `signInWithPassword` calls before `loading` updates.
  Move `setLoading(true)` and the early-return inside the same render-phase
  guard.

- [ ] **`Header` sign-out doesn't await router state.**
  [src/components/Header.tsx:11-15](src/components/Header.tsx#L11-L15).
  After `signOut()` the cookie is cleared, but `router.push("/login")`
  may race with the middleware's redirect on the same request. Usually
  fine; if you see "flash of dashboard before /login," add a
  `router.replace` and a `router.refresh()` after.

### PWA

- [ ] **PWA icons missing.**
  [public/manifest.json:11-14](public/manifest.json#L11-L14). The README
  acknowledges this. Without `icon-192.png` / `icon-512.png` the install
  prompt won't appear on Android/iOS and the web push notification has no
  icon. Ship default icons.

- [ ] **`viewport.maximumScale = 1` & `userScalable = false` block accessibility zoom.**
  [src/app/layout.tsx:16-18](src/app/layout.tsx#L16-L18). WCAG 1.4.4 violation
  on iOS Safari. Remove or set `maximumScale: 5`.

### Agents — Linux / macOS

- [ ] **`sleep "$((MONITOR_INTERVAL - 5))"` goes negative for small intervals.**
  [scripts/linux-agent.sh:238](scripts/linux-agent.sh#L238),
  [scripts/macos-agent.sh:283](scripts/macos-agent.sh#L283). If a user sets
  `MONITOR_INTERVAL=3`, sleep gets `-2` and bash prints an error or no-ops.
  Clamp to a minimum (e.g. `sleep $(( interval > 5 ? interval - 5 : 1 ))`).

- [ ] **Linux CPU calculation drops fields.**
  [scripts/linux-agent.sh:43-53](scripts/linux-agent.sh#L43-L53). `read _ a b
  c idle1 _` only reads user/nice/system/idle and lumps the rest into `_`.
  `iowait`, `irq`, `softirq` are not counted as idle but should be counted
  in `total`. Result: under heavy iowait, CPU% is inflated. Fix: read all
  numeric columns and sum them properly.

- [ ] **macOS top_procs truncates `comm` to ~16 chars on default ps.**
  [scripts/macos-agent.sh:103](scripts/macos-agent.sh#L103). Use `-c -o
  command=` or pass `-w` to widen, then take the basename, so process names
  like `com.docker.virtualization` don't appear identical.

- [ ] **macOS interfaces — netstat -ibn dedupe drops bridges.**
  [scripts/macos-agent.sh:163-167](scripts/macos-agent.sh#L163-L167).
  `seen[$1]++` keeps only the first row for each iface name; that's right
  for the byte counters, but bridges (`bridge0`) often have an empty status
  in `ifconfig`, so they show up as `unknown`. Treat empty status as `down`.

- [ ] **macOS / Linux `ping_stats` returns `null` (literal) for latency.**
  [scripts/linux-agent.sh:131-138](scripts/linux-agent.sh#L131-L138),
  [scripts/macos-agent.sh:174-187](scripts/macos-agent.sh#L174-L187). When
  the ping target is unreachable, the JSON payload becomes
  `"ping_latency_ms": null` (good — the route accepts null), but if a
  parsed average is malformed (e.g. locale uses comma decimal), it sends
  the literal token `null,5` (bad — invalid JSON). Add a numeric regex
  check before substitution.

- [ ] **Agents do not check ingest HTTP status.**
  [scripts/linux-agent.sh:227-231](scripts/linux-agent.sh#L227-L231),
  [scripts/macos-agent.sh:274-278](scripts/macos-agent.sh#L274-L278),
  [scripts/windows-agent.ps1:270-275](scripts/windows-agent.ps1#L270-L275).
  Silent failures hide auth typos and broken payloads. Log a warning on
  non-2xx so the user can `journalctl -u monitor-agent` and see something.

### Agent — Windows

- [ ] **`Get-PingStats` averages including timed-out packets.**
  [scripts/windows-agent.ps1:152-153](scripts/windows-agent.ps1#L152-L153).
  `Test-Connection`'s `ResponseTime` is `0` for failed pings; the average
  is then under-reported when some packets are lost. Filter `Where-Object
  { $_.StatusCode -eq 0 }` first.

- [ ] **Windows agent has no log file by default.**
  Acknowledged in README. Add an opt-in `Start-Transcript -Path
  $env:ProgramData\MonitorAgent\agent.log -Append` near the top of the
  agent block; rotate via simple size check.

- [ ] **Windows `Invoke-Traceroute` parser breaks on non-en-US output.**
  [scripts/windows-agent.ps1:174-185](scripts/windows-agent.ps1#L174-L185).
  Parsing depends on the literal token `ms`. On localised Windows installs
  (e.g. German "ms" but punctuation differs in some locales) the regex
  may miss latencies. Document English-only support or call `tracert` with
  forced culture.

---

## 🟡 P2 — Improvements / Polish

### UX / Accessibility

- [ ] **No skip-to-content link.** Add one in `src/app/layout.tsx` for
  keyboard users.

- [ ] **Color-only status indicators (red/green badges).**
  [src/components/HostCard.tsx:21-24](src/components/HostCard.tsx#L21-L24)
  and similar. Add an icon or text prefix so colour-blind users can
  distinguish "Online" vs "Offline" reliably. Today the badge text is
  present, which is good — but the *cards* go red/green by tone with no
  textual cue at a glance.

- [ ] **Charts have no aria labels or text alternatives.**
  [src/components/MetricChart.tsx](src/components/MetricChart.tsx),
  [src/components/Sparkline.tsx](src/components/Sparkline.tsx).
  Add `role="img"` and an `aria-label` summarising the latest value and
  range, e.g. `aria-label="CPU 12% (5m avg 18%)"`.

- [ ] **Hard-coded dark mode.**
  [src/app/layout.tsx:22](src/app/layout.tsx#L22),
  [src/app/globals.css:50](src/app/globals.css#L50). Respect
  `prefers-color-scheme` and offer a toggle in the header.

- [ ] **Threshold (90%) is hard-coded.** README acknowledges. Lift to a
  workspace-level setting.

- [ ] **Toasts / notifications missing for async actions.** Rename, delete,
  toggle public, push opt-in — none of them confirm success outside the
  dialog. A small toast layer would help.

- [ ] **Empty states show copy but no CTA.**
  [src/components/HostsBrowser.tsx:78-81](src/components/HostsBrowser.tsx#L78-L81).
  When `hosts.length === 0`, prompt with the "Add host" button inline.

- [ ] **Add a confirm-and-type-name guard on host delete.**
  [src/components/HostMenu.tsx:121-141](src/components/HostMenu.tsx#L121-L141)
  has a confirm-second-click but a single misclick still fires deletion.
  For irreversible action with associated metric data, require typing the
  host name to confirm.

- [ ] **`RelativeTime` re-renders every 30s indiscriminately.**
  [src/components/RelativeTime.tsx:21-26](src/components/RelativeTime.tsx#L21-L26).
  For dashboards with 50 hosts that's 50 timers. Centralise via a single
  rAF/setInterval in a context and broadcast updates.

- [ ] **Login error messaging shows raw Supabase error strings.**
  [src/app/login/page.tsx:25](src/app/login/page.tsx#L25). Map
  `Invalid login credentials` to a friendlier line and avoid leaking
  internal codes.

- [ ] **Public status page lacks "Last updated" timestamp.**
  [src/app/status/[token]/page.tsx](src/app/status/%5Btoken%5D/page.tsx).
  Show when each host's metric was last received in a more prominent
  position so visitors know how stale the data is.

### Performance

- [ ] **Dashboard hydrates with up to 60 metrics × N hosts in HTML.**
  [src/app/dashboard/page.tsx:38-50](src/app/dashboard/page.tsx#L38-L50).
  Acceptable today but won't scale past ~50 hosts. Consider sending only
  the latest metric per host on initial load and letting realtime fill
  in the chart series.

- [ ] **`HostCard`/`HostList` reverse the metrics array on every render.**
  [src/components/HostCard.tsx:18-19](src/components/HostCard.tsx#L18-L19).
  Memoise per-host series to avoid the O(N) work each render.

- [ ] **`MetricChart` `viewBox` is fixed at 600 wide regardless of points
  density.** Long series get over-densified at narrow viewports. Sample
  the points (e.g. one per minute when zoomed out) before rendering.

- [ ] **No DB index on `metrics.created_at` alone.**
  [supabase/migrations/20260427000000_initial_schema.sql:72](supabase/migrations/20260427000000_initial_schema.sql#L72).
  Retention deletes scan with `created_at < now() - interval '24 hours'`;
  the existing composite `(host_id, created_at desc)` works but is
  sub-optimal. Consider an additional `(created_at)` index for cleanup.

### Code quality / DX

- [ ] **No unit tests, no integration tests, no e2e tests.** README
  acknowledges. Bring in Vitest for `route.ts` validators and Playwright
  for the auth/RLS happy path.

- [ ] **No ESLint/Prettier config in repo.** `next lint` runs the default
  but there's no `.eslintrc` or `.prettierrc` checked in. Add to enforce
  consistent style.

- [ ] **Missing `engines` field in `package.json`.** Pin Node version
  (e.g. `>=18.18`) so contributors and Vercel agree.

- [ ] **`scripts/build` step missing in `package.json`.** It's in
  defaults via `next build`, but no `prebuild` schema check, no
  `typecheck` script. Add explicit `"typecheck": "tsc --noEmit"`.

- [ ] **No CI workflow.** Add a GitHub Actions workflow that runs
  install + lint + typecheck + build on PRs.

- [ ] **`.env.example` doesn't document optional vs required.**
  [.env.example](.env.example). Mark each var with `# required` or
  `# optional` and what fails if missing.

- [ ] **No request logging on API routes.** Hard to debug agent / ingest
  issues. Add a minimal log line per request, including host_id and
  outcome.

### Security hardening

- [ ] **No rate limiting on ANY endpoint.** A leaked api_key allows
  unlimited ingest; an attacker who knows a host_id can repeatedly fetch
  the install script. Add per-IP and per-key throttling (Upstash Redis
  free tier is the usual fit on Vercel).

- [ ] **No CSRF token / sameSite hardening review for the dashboard
  mutation endpoints.** Supabase cookies default to SameSite=Lax which
  blocks CSRF for cross-site POSTs, but if a future API route accepts
  POST + cookie auth, document that explicitly or add a CSRF check.

- [ ] **`HostMenu` install URL is rendered into the DOM.** Anyone with
  XSS in the dashboard could exfiltrate it. There is no XSS today, but
  enable CSP via `next.config.mjs` headers to add defence in depth.

- [ ] **Service worker has no integrity check.**
  [public/sw.js](public/sw.js). If the cache is poisoned, stale UI
  persists. Move to a hashed cache name and version it via the build
  pipeline.

- [ ] **`api_key` never rotates.** No "regenerate api_key" button on
  the host detail page. If a key leaks, the only remedy today is to
  delete and re-create the host (losing metric history). Add a rotate
  action that updates `hosts.api_key` and asks the user to re-run
  the installer.

- [ ] **Public status page allows directory enumeration via timing.**
  Unlikely material but: 404 vs 200 timings on `/status/<token>` are
  distinguishable. Ensure a constant-time response for non-matching
  tokens.

- [ ] **Service-role key path executes anywhere in app code.**
  [src/lib/supabase/server.ts:29-36](src/lib/supabase/server.ts#L29-L36).
  Add a runtime assertion that `process.env.NEXT_RUNTIME === "nodejs"`
  to catch accidental edge-runtime imports.

### Operations

- [ ] **No retention on `push_subscriptions`.** Stale endpoints from
  uninstalled browsers will accumulate. Add a cron that prunes
  subscriptions that have been failing for 7 days (requires checking
  the response from web-push).

- [ ] **`flip_offline_hosts` doesn't trigger any side-effect.**
  [supabase/migrations/20260427000000_initial_schema.sql:226-237](supabase/migrations/20260427000000_initial_schema.sql#L226-L237).
  The README points at `supabase/functions/heartbeat` for push but
  the cron itself doesn't `pg_notify` or invoke the function. Wire
  up the function call (or document the dependency in the migration).

- [ ] **No backup / export of hosts metadata.** Agents store nothing
  locally; if the Supabase project is wiped, all api_keys / host_ids
  are gone and every agent must be re-installed. Add a "Export
  workspace" JSON download.

- [ ] **No health-check route.** A `GET /api/health` (200 + DB
  connectivity check) is helpful for uptime monitoring of the
  monitor itself.

- [ ] **`pg_cron` schedules collide with manual SQL editing.**
  Re-running the migration adds duplicate `cron.schedule` rows.
  Wrap each in `select cron.unschedule('name')` first, or use
  `cron.schedule_in_database`'s upsert pattern.

---

## ✅ Tested & Verified Behaviours

The following were checked and look correct:

- RLS policies isolate workspaces, hosts, metrics, host_commands,
  push_subscriptions correctly via `auth.uid()` joins.
- `host_commands` claim is atomic via `UPDATE … WHERE status='pending'
  RETURNING`.
- Public views (`public_hosts`, `public_metrics`) filter by
  `workspaces.is_public` and exclude `api_key`.
- Per-host `api_key` is verified before each ingest and command result
  write.
- `.gitignore` excludes `.env*.local`.
- Middleware exempts agent endpoints from auth and protects
  `/dashboard/*`.
- Atomic per-host realtime channels (`host-detail-${id}`) avoid
  cross-talk.

---

## How to use this list

Recommend handling P0s as a single "fix breakage" PR (schema migration +
the truncation crash + the macOS launchctl bug + the Windows tracert flag).
Then split P1s by domain and assign. P2s become a backlog grooming exercise.

After fixing P0s, regression-test by:

1. Running the migration against a clean Supabase project.
2. Installing each agent on a real Linux/macOS/Windows host.
3. Verifying metrics arrive within 60s and CPU/RAM/Disk render.
4. Triggering a traceroute from the dashboard and watching it complete.
5. Toggling the public status page on/off and confirming token rotation
   (after the P1 fix lands).
6. Signing out, refreshing, signing back in — confirming no flicker
   of stale dashboard.
