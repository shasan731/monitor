# Monitor

A mobile-first PWA for monitoring Linux, macOS, and Windows servers. Free-tier
deployable on Vercel + Supabase, dependency-free agents written in vanilla bash
and PowerShell, real-time dashboard, on-demand traceroute, and an opt-in public
status page.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Architecture](#architecture)
5. [Data model](#data-model)
6. [API surface](#api-surface)
7. [Agent protocol](#agent-protocol)
8. [Setup — Supabase + local dev](#setup--supabase--local-dev)
9. [Deploying to Vercel](#deploying-to-vercel)
10. [Adding a host](#adding-a-host)
11. [Per-OS agent details](#per-os-agent-details)
12. [Project structure](#project-structure)
13. [Free-tier hygiene](#free-tier-hygiene)
14. [Security model](#security-model)
15. [Known gaps & roadmap](#known-gaps--roadmap)

---

## What it does

Monitor lets you point a one-line install command at any Linux/macOS/Windows
machine you own and immediately watch its CPU, RAM, disk, top processes,
network interfaces, and ping/traceroute health from a phone or browser. It is
designed for personal/homelab use and small teams: every layer fits inside the
free tiers of Vercel and Supabase, and the agents are short, auditable shell
scripts with no compiled binaries or extra runtime dependencies.

**Why it exists.** The major hosted monitoring tools (Datadog, NewRelic) are
overkill and expensive for handfuls of personal servers. Self-hosting Prometheus
+ Grafana + Alertmanager works but is a chunk of ops to keep alive. Monitor
sits in the middle: managed Postgres + Auth + Realtime via Supabase, but a
single small Next.js app you control, deployable for free.

---

## Features

### Dashboard

- **Overview tab**
  - Six live stat cards: Total · Online · Offline · CPU ≥90% · RAM ≥90% · Disk ≥90%.
    The threshold (default `90%`) is a single prop; the alert cards turn red
    with a destructive border when count > 0.
  - **Needs attention** panel — auto-list of hosts that are offline or breaching
    any threshold, severity-sorted, each row clickable through to detail.
- **Hosts tab**
  - Search + **Grid / List** toggle (preference saved in `localStorage`)
  - Each host card/row shows status badge, OS, last beat, CPU/RAM sparklines,
    latest CPU/RAM/Disk%, and a `⋮` menu for rename / re-show install command / delete
- **Header actions** available from any tab: Add host, Public status toggle,
  Web Push opt-in, Sign out

### Per-host detail page (`/dashboard/hosts/[id]`)

- **Meta strip** — Status, OS, Last beat, Created, Host ID (copyable), API key
  (eye toggle + copy)
- **Charts** — CPU / Memory / Disk over the last hour with grid lines, time
  axis, and large latest-value display
- **Processes** — process count + Top 5 by CPU% + Top 5 by RAM%
- **Network** — every interface with status badge (Up/Down), real-time
  throughput in/out (auto-scaled bytes→KB→MB), MAC, IPv4
- **Connectivity** — latency tile, packet loss tile, latency-over-time chart
  for ICMP ping to the agent's configured target (default `1.1.1.1`)
- **Traceroute** — input a hostname/IP, click Run, watch hops fill in live as
  the agent picks up the queued command and reports back

### PWA

- Installable on iOS/Android/desktop (manifest + icons)
- Custom service worker caches the app shell and proxies pushes
- Web Push for offline notifications (optional — needs VAPID keys)

### Multi-tenancy & sharing

- Email/password Supabase auth; signup trigger auto-creates a default workspace
- Strict Row Level Security keeps every workspace's hosts and metrics fully
  isolated
- **Public status page** — toggle the globe icon on the dashboard to enable;
  shareable read-only URL at `/status/<token>`. No login, no API keys exposed,
  only sanitised data.

### Operations

- `pg_cron` jobs handle: 24h metric retention, 7d command retention, and a
  per-minute "flip stale online → offline" task — no Vercel cron needed
- Real-time updates everywhere via Supabase Realtime (hosts, metrics,
  host_commands tables)
- Agents are vanilla bash / PowerShell — no compiled binaries, no agent runtime
- One install one-liner per host. Re-run to update or migrate to a new machine.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS, shadcn-style UI primitives, Lucide icons |
| Auth | Supabase Auth (email/password) via `@supabase/ssr` cookie sessions |
| Database | Supabase PostgreSQL with Row Level Security |
| Realtime | Supabase Realtime (`postgres_changes` channels) |
| Cron | `pg_cron` (lives inside Supabase — no external scheduler) |
| Hosting | Vercel (Hobby tier) — Node runtime for API routes |
| PWA | Manifest + custom service worker (no `next-pwa` dep) |
| Charts | Hand-rolled SVG (zero chart-library deps) |
| Agents | Vanilla bash (Linux/macOS) + Vanilla PowerShell 5.1+ (Windows) |

---

## Architecture

```
                          ┌──────────────────────────────┐
                          │  Browser (PWA)               │
                          │  Next.js App Router          │
                          │  • Auth via Supabase cookies │
                          │  • Realtime over WebSocket   │
                          └──────────────┬───────────────┘
                                         │ HTTPS
                                         ▼
            ┌──────────────────────────────────────────────────┐
            │  Vercel (Next.js)                                │
            │   • /api/install/[host_id]  — templated agent    │
            │   • /api/ingest             — agent metric POST  │
            │   • /api/commands/pending   — agent claim cmds   │
            │   • /api/commands/[id]/result — agent reports    │
            │   • /api/push/subscribe     — web-push manager   │
            │   • /auth/callback          — supabase OAuth     │
            └──────────────┬───────────────────┬───────────────┘
                           │                   │
                           │  pg via SDK       │  realtime ws
                           ▼                   ▼
                    ┌───────────────────────────────────┐
                    │  Supabase                         │
                    │   • Auth (auth.users)             │
                    │   • Postgres                      │
                    │     - profiles, workspaces, hosts │
                    │     - metrics, host_commands      │
                    │     - push_subscriptions          │
                    │   • RLS on every public table     │
                    │   • pg_cron schedules             │
                    │   • Realtime publication          │
                    └───────────────────────────────────┘
                           ▲                   ▲
                           │                   │
            ┌──────────────┴────────────────────┴──────────────┐
            │  Agents on monitored hosts                       │
            │   Linux:   bash + systemd                        │
            │   macOS:   bash + launchd                        │
            │   Windows: PowerShell + Scheduled Task           │
            │  Outbound HTTPS only — no inbound ports.         │
            └──────────────────────────────────────────────────┘
```

Agents authenticate themselves with a per-host `api_key` (a 24-byte random
hex string) via the `X-API-Key` header. The dashboard authenticates the user
via Supabase cookie sessions and is gated by RLS at the database level.

---

## Data model

```
auth.users  ──1:1──  public.profiles  ──1:N──  workspaces
                                                  │
                                                1:N
                                                  ▼
                                                hosts ─1:N─→ metrics
                                                  │       └─→ host_commands
                                                  │
                                              api_key       (per-row secret
                                                             for agent auth)

profiles ──1:N── push_subscriptions
```

### Tables

| Table | Purpose |
|---|---|
| `profiles` | Per-user metadata, mirrors `auth.users.id` |
| `workspaces` | Tenancy boundary; owns hosts. `is_public` + `public_token` for the public status page |
| `hosts` | One row per monitored machine. Carries `api_key`, `os_type`, `last_beat`, `status` |
| `metrics` | Time-series snapshots. CPU/RAM/Disk + JSONB for top processes & interfaces + ping latency/loss |
| `host_commands` | Bidirectional command channel. Dashboard inserts `pending`, agent claims/runs/reports |
| `push_subscriptions` | Browser Web Push subscriptions for offline alerts |

### Views

| View | Purpose |
|---|---|
| `public_hosts` | Sanitised hosts joined with public workspaces — exposes name, OS, status, last_beat. **No `api_key`.** Granted to `anon`. |
| `public_metrics` | Sanitised metrics for public workspaces. Granted to `anon`. |

### Cron (`pg_cron`)

| Schedule | Job | Purpose |
|---|---|---|
| `* * * * *` | `flip_offline_hosts()` | Mark hosts as offline if `last_beat` is older than 2 minutes |
| `7 * * * *` | `cleanup_old_metrics()` | Delete metrics older than 24 hours (free-tier hygiene) |
| `13 * * * *` | `cleanup_old_commands()` | Delete completed commands older than 7 days |

---

## API surface

All routes are Next.js App Router under `src/app/api/`.

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/install/[host_id]` | GET | unguessable host UUID | Returns the templated agent script for the host's OS, with `host_id`, `api_key`, and `ingest_url` baked in |
| `/api/ingest` | POST | `X-API-Key` matches `hosts.api_key` | Ingest a metric snapshot. Validates and clamps every field, atomically updates `last_beat` + `status`. |
| `/api/commands/pending` | GET | `X-API-Key` | Atomically claims any `pending` commands for the host (flips them to `running` and returns them). Supports `?fmt=tsv` for bash-friendly output. |
| `/api/commands/[id]/result` | POST | `X-API-Key` (must own the command's host) | Agent reports `completed`/`failed`/`timeout` + result JSONB |
| `/api/push/subscribe` | POST/DELETE | session cookie | Manage the user's browser Web Push subscription |
| `/auth/callback` | GET | — | Exchanges OAuth code for a session cookie |

Middleware exempts `/api/install`, `/api/ingest`, `/api/commands` from auth so
agents (which have no session) can reach them. Auth on those routes is enforced
inside each handler via the per-host `api_key`.

---

## Agent protocol

### Metrics push (every 60s)

```http
POST /api/ingest
X-API-Key: <hosts.api_key>
Content-Type: application/json

{
  "host_id": "<uuid>",
  "cpu_usage": 23.4,
  "ram_usage": 61.2,
  "disk_usage": 45.0,
  "process_count": 142,
  "top_cpu_processes": [{"pid":1234,"name":"chrome","cpu_pct":12.3,"ram_pct":5.4}, ...],
  "top_ram_processes": [...],
  "interfaces":         [{"name":"eth0","status":"up","rx_bps":12345,"tx_bps":6789,"mac":"...","ip":"..."}, ...],
  "ping_latency_ms": 12.3,
  "ping_loss_pct": 0,
  "ping_target": "1.1.1.1"
}
```

Validated and clamped on the server: percentages 0–100, ≤10 processes per
top-list, ≤32 interfaces, name lengths capped, etc.

### Command poll & result (every 60s)

After posting metrics, the agent polls:

```http
GET /api/commands/pending?host_id=<uuid>&fmt=tsv
X-API-Key: <hosts.api_key>

→ id1|traceroute|1.1.1.1
  id2|traceroute|github.com
```

The endpoint atomically `UPDATE…WHERE status='pending' RETURNING …`, so two
concurrent agents can't run the same command twice. Each claimed command is
flipped to `running` and `started_at` is stamped.

For each claimed command the agent runs it locally, then:

```http
POST /api/commands/<id>/result
X-API-Key: <hosts.api_key>
Content-Type: application/json

{
  "status": "completed",
  "result": { "hops": [...], "target": "1.1.1.1", "duration_ms": 4230 }
}
```

The dashboard's TracerouteCard subscribes to UPDATE events on the
`host_commands` row and renders progress live: `pending → running → completed`.

---

## Setup — Supabase + local dev

### 1. Create a Supabase project

Free tier is sufficient. Note your project ref (`<project>` in URLs below).

### 2. Run the migration

In the dashboard SQL editor (https://supabase.com/dashboard/project/&lt;ref&gt;/sql/new),
paste the contents of `supabase/migrations/20260427000000_initial_schema.sql`
and run. This creates all tables, RLS policies, the signup trigger, the
public-status views, and the three `pg_cron` schedules.

### 3. Disable email confirmation (optional, recommended for local dev)

`Auth → Providers → Email → Confirm email = OFF` so signups land you in the
dashboard immediately. Skip if you want the email round-trip.

### 4. Grab API keys

`Settings → API` →
- `Project URL` → `https://<project>.supabase.co`
- `anon`/`publishable` key
- `service_role`/`secret` key

### 5. Configure local env

```bash
cp .env.example .env.local
```

Fill in:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…    # or eyJ… for legacy keys
NEXT_PUBLIC_APP_URL=http://localhost:3000

SUPABASE_SERVICE_ROLE_KEY=sb_secret_…              # or eyJ…

# Optional — Web Push. Generate with: npx web-push generate-vapid-keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

### 6. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, sign up, you'll land on the empty dashboard.

---

## Deploying to Vercel

1. Push the repo to GitHub.
2. Import to Vercel.
3. Add the env vars from `.env.example` in **Settings → Environment Variables**.
   Set `NEXT_PUBLIC_APP_URL` to your Vercel domain (e.g.
   `https://my-monitor.vercel.app`).
4. Deploy. The install endpoint will start serving installers that point agents
   at the public domain.

The metric ingest, command channel, install endpoint, and push subscribe are
all Next.js routes — no separate Edge Function deployment needed for normal
operation. **Web Push notifications** for offline events use a Supabase Edge
Function (`supabase/functions/heartbeat/`) which still requires the Supabase
CLI to deploy if you want it; without it, hosts still flip to offline via
the per-minute pg_cron job, you just don't get push notifications.

---

## Adding a host

1. Open the dashboard → **Add host** → name and OS.
2. Copy the one-liner, run it on the target machine:

   | OS | Command |
   |---|---|
   | Linux | `curl -sSL https://your-monitor/api/install/<host_id> \| sudo bash` |
   | macOS | `curl -sSL https://your-monitor/api/install/<host_id> \| sudo bash` |
   | Windows | `iwr -useb https://your-monitor/api/install/<host_id> \| iex` (elevated PowerShell) |

3. The agent installs as a system service and starts reporting within ~60s.
   The host card flips from **Pending** to **Online** on the next metric.

To migrate the agent to a different machine, re-run the same one-liner on the
new machine — same `host_id`, same `api_key`, same row. To uninstall, see
[Per-OS agent details](#per-os-agent-details).

---

## Per-OS agent details

### What each metric source maps to per-OS

| Metric | Linux | macOS | Windows |
|---|---|---|---|
| CPU% | `/proc/stat` deltas | `top -l 1 -n 0` parse | `Get-Counter "\Processor(_Total)\% Processor Time"` |
| RAM% | `/proc/meminfo` | `vm_stat` + `sysctl hw.memsize` | `Get-CimInstance Win32_OperatingSystem` |
| Disk% | `df -P /` | `df -P /` | `Get-CimInstance Win32_LogicalDisk` |
| Process count | `ps -e \| wc -l` | `ps -A \| wc -l` | `(Get-Process).Count` |
| Top procs | `ps --sort=-%cpu/-%mem` | `ps -Ar` / `-Am` (BSD) | `Get-Process` + `.CPU` deltas across iterations |
| Interfaces | `/proc/net/dev` byte deltas | `netstat -ibn` ($(NF-4)/$(NF-1)) | `Get-NetAdapterStatistics` |
| If status / IP | `/sys/class/net/*/operstate`, `ip -4 -o addr` | `ifconfig` `status: active/inactive` + `inet` | `Get-NetAdapter.Status`, `Get-NetIPAddress` |
| Ping | `ping -c 4 -W 1 -q` | `ping -c 4 -t 5 -q` (`-W` is ms on macOS!) | `Test-Connection -Count 4` |
| Traceroute | `traceroute -n -q 3 -w 1 -m 30` | same (built-in) | `tracert.exe -d -h 30 -w 1000` |
| Service mgr | systemd | launchd | Scheduled Task |

### Linux

- **Install:** `/opt/monitor-agent/agent.sh`, `/opt/monitor-agent/agent.env` (mode 600), `/etc/systemd/system/monitor-agent.service`
- **Service:** `systemctl status monitor-agent`
- **Logs:** `journalctl -u monitor-agent -f`
- **Traceroute requires** the `traceroute` package (`apt install traceroute` on Debian/Ubuntu). Without it, the agent reports a friendly error in the result.
- **Uninstall:**
  ```bash
  sudo systemctl disable --now monitor-agent
  sudo rm -f /etc/systemd/system/monitor-agent.service
  sudo systemctl daemon-reload
  sudo rm -rf /opt/monitor-agent
  ```

### macOS

- **Install:** `/usr/local/lib/monitor-agent/agent.sh`, `/usr/local/lib/monitor-agent/agent.env` (mode 600), `/Library/LaunchDaemons/com.monitor.agent.plist`
- **Service:** `sudo launchctl print system/com.monitor.agent`
- **Logs:** `tail -f /var/log/monitor-agent.log`
- **Traceroute** is built-in (`/usr/sbin/traceroute`).
- **Uninstall:**
  ```bash
  sudo launchctl bootout system /Library/LaunchDaemons/com.monitor.agent.plist
  sudo rm -rf /usr/local/lib/monitor-agent /Library/LaunchDaemons/com.monitor.agent.plist /var/log/monitor-agent.log*
  ```

### Windows

- **Install:** `C:\ProgramData\MonitorAgent\agent.ps1`, Scheduled Task `MonitorAgent` running as SYSTEM, `RunAtStartup`
- **Service:** `Get-ScheduledTask MonitorAgent`
- **Logs:** none by default (silent run); add a `Start-Transcript` to `agent.ps1` if you need them
- **Tracert** is built-in (`tracert.exe`).
- **Uninstall:**
  ```powershell
  Stop-ScheduledTask    -TaskName MonitorAgent -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName MonitorAgent -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'MonitorAgent\\agent.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Remove-Item -Recurse -Force "$env:ProgramData\MonitorAgent"
  ```

---

## Project structure

```
src/
  app/
    api/
      install/[host_id]/   templated agent installer (per OS)
      ingest/              metric ingestion endpoint
      commands/
        pending/           agent claims pending commands
        [id]/result/       agent reports command result
      push/subscribe/      web-push subscription manager
    auth/callback/         Supabase OAuth callback
    dashboard/
      layout.tsx           authenticated shell (Header + container)
      page.tsx             Overview / Hosts tabs
      hosts/[id]/page.tsx  per-host detail (server) + HostDetailClient
    status/[token]/        public read-only status page
    login/  signup/        unauthenticated entry points
    layout.tsx             root html, registers /sw.js
    globals.css            Tailwind + shadcn CSS variables

  components/
    DashboardClient.tsx    owns realtime state + tabs
    DashboardStats.tsx     6 stat cards (Total/Online/Offline + thresholds)
    HostsBrowser.tsx       search + grid/list toggle + render
    HostCard.tsx           grid view tile (clickable to detail)
    HostList.tsx           list-view row (clickable)
    HostMenu.tsx           rename / re-show install / delete
    HostDetailClient.tsx   detail page client: realtime + all sections
    MetricChart.tsx        SVG line chart with grid + axes (deps-free)
    Sparkline.tsx          tiny SVG sparkline used in cards/list
    ProcessTable.tsx       Top CPU / Top RAM tables
    InterfaceTable.tsx     interfaces with throughput
    TracerouteCard.tsx     input + run + realtime hop table
    TopIssues.tsx          Overview "needs attention" panel
    AddHostDialog.tsx      add host modal
    PublicShareToggle.tsx  toggle workspace public + share URL
    PushOptIn.tsx          web-push opt-in button
    Header.tsx             workspace name + email + sign-out
    RelativeTime.tsx       SSR-safe "x ago" string
    ui/                    shadcn-style primitives (button/card/input/dialog/badge/label)

  lib/
    supabase/
      client.ts            createBrowserClient
      server.ts            createServerClient + service-role admin client
      middleware.ts        cookie-based session refresh
    types.ts               Host, Metric, ProcessInfo, InterfaceInfo, HostCommand, …
    utils.ts               cn(), formatRelative()

middleware.ts              gates /dashboard, exempts agent endpoints

supabase/
  migrations/
    20260427000000_initial_schema.sql   tables + RLS + cron + views + realtime
  functions/
    ingest/index.ts        Deno-flavoured ingest (legacy; replaced by /api/ingest)
    heartbeat/index.ts     offline detection + Web Push (CLI-deploy required)

scripts/
  linux-agent.sh           systemd service + bash agent (templated)
  macos-agent.sh           launchd plist + bash agent (templated)
  windows-agent.ps1        Scheduled Task + PowerShell agent (templated)

public/
  manifest.json            PWA manifest
  sw.js                    custom service worker (cache shell + push handler)
  icon-192.png/icon-512.png (add your own — placeholders missing today)
```

---

## Free-tier hygiene

- **Metric cadence** is one POST per host per minute. With 5 hosts that's
  ~7,200 ingest requests/day, well inside Supabase's free-tier API budget.
- **Per-record size** is ~1–2 KB (most of it is the JSONB process and
  interface arrays). 1,440 records/day per host × 5 hosts = ~10 MB/day, but
  the hourly retention cron caps it at ~1.5 MB per host.
- **Retention** runs in `pg_cron` inside the Supabase project, so it costs
  nothing extra: metrics > 24h are deleted hourly, host_commands > 7d are
  deleted hourly.
- **Realtime** publication is restricted to `hosts`, `metrics`, and
  `host_commands` so we're not paying to broadcast push subscriptions.
- **No Vercel cron** is used — `pg_cron` does offline detection. Vercel
  Hobby's once-a-day cron limit is irrelevant.
- **PWA service worker** caches the shell. API calls always hit the network.

---

## Security model

| Boundary | Enforcement |
|---|---|
| User → user (cross-tenant access) | RLS on every table; `auth.uid()` is the gate. The server-side admin client (service role) is never returned from a route the user can hit. |
| User → metrics writes | Users have **no** insert policy on `metrics`. All writes go through `/api/ingest`, which uses the service-role client and authenticates via `X-API-Key`. |
| Agent → agent (different host) | Each command's `host_id` is joined to `hosts.api_key` before applying the result. A leaked key for host A can't tamper with commands on host B. |
| Public visitor → private workspace | Only `public_hosts` / `public_metrics` views are granted to the `anon` role; both filter by `workspaces.is_public = true`. The `api_key` is not in either view. |
| Browser → server | All routes that mutate go through Supabase cookies (RLS-checked) or the service-role admin client (only callable server-side and only for ingest/commands/install). |

Two notes:

- The install URL itself acts as the bearer token — anyone who has the URL can
  install the agent on any machine. The `host_id` is a 128-bit UUID, so
  guessing one is intractable. Treat installer URLs as you would treat the
  `api_key`.
- Agents validate their target hostname/IP only loosely (regex
  `[a-zA-Z0-9._:\-]+`). They pass the target as a single argv to
  `traceroute`/`tracert`, so shell-metacharacter escapes are not an issue, but
  a malicious user with dashboard access could DoS by enqueuing many
  long-running traceroutes. RLS prevents non-owners from doing that against
  your hosts.

---

## Known gaps & roadmap

- **Web Push notifications** for offline alerts require deploying the
  `supabase/functions/heartbeat/` Edge Function via the Supabase CLI. Without
  it, hosts still flip to offline in the dashboard via the per-minute pg_cron
  job — you just don't get a push.
- **PWA icons** at `public/icon-192.png` and `public/icon-512.png` are not
  bundled. Add your own to make the app installable with a proper home-screen
  tile.
- **Linux traceroute** depends on the `traceroute` package being installed
  (`apt install traceroute`). The agent reports a friendly error in the result
  if it isn't, but doesn't auto-install.
- **Threshold (90%)** is hard-coded in `DashboardStats` and `TopIssues`. Could
  be lifted into a workspace-level setting easily.
- **Command kinds** is currently `traceroute` only. The `host_commands.kind`
  CHECK constraint and the `case "$kind" in` switch in each agent are the only
  places to extend — adding e.g. `restart_service`, `tail_logs`, `disk_du` is a
  small change per kind.
- **Agent command latency** is up to ~60s (next agent loop tick). For sub-second
  command dispatch you'd want a Realtime websocket subscription on the agent —
  worth it only for kinds where latency matters.
- **No tests yet** — everything is hand-tested. Worth adding Vitest for the
  ingest route validators and Playwright for the dashboard auth/RLS flow if
  this graduates from personal use.
