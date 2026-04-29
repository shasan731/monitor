#!/usr/bin/env bash
# Monitor — macOS agent installer.
# Templated by /api/install/[host_id]; placeholders are replaced server-side.
# Standalone: set MONITOR_HOST_ID, MONITOR_API_KEY, MONITOR_INGEST_URL.
#
# macOS-specific differences from the Linux agent:
#   • Service manager: launchd plist instead of systemd unit
#   • CPU: parses `top -l 1` (no /proc/stat)
#   • RAM: vm_stat + sysctl hw.memsize (no /proc/meminfo)
#   • Interfaces: `netstat -ibn` (no /proc/net/dev) + `ifconfig` for status/IP
#   • ps: BSD flavour — `-r` sorts by CPU, `-m` by memory
#   • ping: -t (deadline secs) instead of -W (timeout per packet)

set -euo pipefail

HOST_ID="${MONITOR_HOST_ID:-__HOST_ID__}"
API_KEY="${MONITOR_API_KEY:-__API_KEY__}"
INGEST_URL="${MONITOR_INGEST_URL:-__INGEST_URL__}"
INTERVAL="${MONITOR_INTERVAL:-60}"
PING_TARGET="${MONITOR_PING_TARGET:-1.1.1.1}"

if [[ "$HOST_ID" == __* || "$API_KEY" == __* || "$INGEST_URL" == __* ]]; then
  echo "monitor: missing config — re-run via the install URL" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "monitor: must run as root (try: curl -sSL <url> | sudo bash)" >&2
  exit 1
fi

INSTALL_DIR=/usr/local/lib/monitor-agent
PLIST=/Library/LaunchDaemons/com.monitor.agent.plist
LOG=/var/log/monitor-agent.log
mkdir -p "$INSTALL_DIR"

# ─── agent script ───────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/agent.sh" <<'AGENT'
#!/usr/bin/env bash
set -uo pipefail

json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

# CPU usage from `top -l 1 -n 0 -s 0` "CPU usage" line.
# Output line looks like: "CPU usage: 12.34% user, 5.67% sys, 82.0% idle"
cpu_usage() {
  top -l 1 -n 0 -s 0 2>/dev/null | awk -F'[,:%]' '
    /^CPU usage/ {
      user = $2; gsub(/[^0-9.]/, "", user)
      sys  = $4; gsub(/[^0-9.]/, "", sys)
      printf "%.1f", user + sys
      exit
    }
  '
}

# RAM used %: total - (free + inactive + speculative) pages.
ram_usage() {
  local total page_size
  total=$(sysctl -n hw.memsize 2>/dev/null)
  page_size=$(sysctl -n hw.pagesize 2>/dev/null)
  [[ -z "$total" || -z "$page_size" ]] && { echo "0"; return; }

  local stats free_p inactive_p spec_p
  stats=$(vm_stat 2>/dev/null)
  free_p=$(    echo "$stats" | awk '/Pages free/        { gsub("[^0-9]","",$3); print $3; exit }')
  inactive_p=$(echo "$stats" | awk '/Pages inactive/    { gsub("[^0-9]","",$3); print $3; exit }')
  spec_p=$(    echo "$stats" | awk '/Pages speculative/ { gsub("[^0-9]","",$3); print $3; exit }')
  [[ -z "$free_p"     ]] && free_p=0
  [[ -z "$inactive_p" ]] && inactive_p=0
  [[ -z "$spec_p"     ]] && spec_p=0

  awk -v t="$total" -v f="$free_p" -v i="$inactive_p" -v s="$spec_p" -v ps="$page_size" 'BEGIN {
    avail = (f + i + s) * ps
    if (t > 0) printf "%.1f", (t - avail) * 100.0 / t
    else printf "0"
  }'
}

disk_usage() {
  df -P / | awk 'NR==2 { gsub("%","",$5); print $5 }'
}

# ps -A on macOS includes a header row; subtract one.
process_count() {
  local n
  n=$(ps -A 2>/dev/null | wc -l | tr -d ' ')
  echo $((n - 1))
}

# Top N processes. macOS ps: -r sorts by CPU%, -m by memory size.
# Use `command=` and `-c` so process names aren't truncated to ~16 chars,
# otherwise long bundle ids like "com.docker.virtualization" get clipped to
# the same prefix and look identical to siblings.
top_procs() {
  local key="$1"           # cpu | mem
  local sort_flag
  if [[ "$key" == "cpu" ]]; then sort_flag="-r"; else sort_flag="-m"; fi
  ps -Ac $sort_flag -o pid=,%cpu=,%mem=,command= 2>/dev/null | head -5 | awk '
    BEGIN { ORS=""; print "[" }
    NF >= 4 {
      if (count++ > 0) print ","
      # Stitch the command back together (it may contain spaces from -c form).
      name = ""
      for (i = 4; i <= NF; i++) { name = (i == 4 ? $i : name " " $i) }
      # Long bundle paths — keep just the basename.
      n = split(name, parts, "/"); name = parts[n]
      gsub(/\\/, "\\\\", name); gsub(/"/, "\\\"", name)
      printf "{\"pid\":%d,\"cpu_pct\":%.1f,\"ram_pct\":%.1f,\"name\":\"%s\"}", $1, $2, $3, name
    }
    END { print "]" }
  '
}

# Network interfaces: byte counters from `netstat -ibn`, status/MAC/IP from ifconfig.
# netstat -ibn columns vary in count depending on whether Address is shown,
# but the last 7 columns are always: Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
# So Ibytes=$(NF-4) and Obytes=$(NF-1) regardless.
declare -A PREV_RX PREV_TX
PREV_TS=0
interfaces_json() {
  local now dt
  now=$(date +%s)
  if (( PREV_TS == 0 )); then dt=0; else dt=$((now - PREV_TS)); fi
  PREV_TS=$now

  local first=1
  printf '['

  while IFS=$'\t' read -r name rx tx; do
    [[ -z "$name" || "$name" == "lo0" ]] && continue
    [[ ! "$rx" =~ ^[0-9]+$ || ! "$tx" =~ ^[0-9]+$ ]] && continue

    local rx_bps=0 tx_bps=0
    if (( dt > 0 )) && [[ -n "${PREV_RX[$name]:-}" ]]; then
      rx_bps=$(( (rx - PREV_RX[$name]) / dt ))
      tx_bps=$(( (tx - PREV_TX[$name]) / dt ))
      (( rx_bps < 0 )) && rx_bps=0
      (( tx_bps < 0 )) && tx_bps=0
    fi
    PREV_RX[$name]=$rx
    PREV_TX[$name]=$tx

    local status="down" mac="" ip=""
    local ifc
    ifc=$(ifconfig "$name" 2>/dev/null)
    if echo "$ifc" | grep -q "status: active"; then
      status="up"
    elif echo "$ifc" | grep -q "status: inactive"; then
      status="down"
    elif echo "$ifc" | head -1 | grep -q "<UP,"; then
      # Bridges (bridge0) often print no `status:` line in ifconfig at all.
      # Falling back to the IFF flags keeps them visible as up rather than
      # mis-categorising them as `unknown`.
      status="up"
    fi
    mac=$(echo "$ifc" | awk '/[ \t]ether / { print $2; exit }')
    ip=$(echo "$ifc"  | awk '/inet [0-9]/ { print $2; exit }')

    (( first )) || printf ','
    first=0
    printf '{"name":"%s","status":"%s","rx_bps":%d,"tx_bps":%d,"mac":"%s","ip":"%s"}' \
      "$(json_escape "$name")" "$status" "$rx_bps" "$tx_bps" \
      "$(json_escape "$mac")" "$(json_escape "$ip")"
  done < <(netstat -ibn 2>/dev/null | awk '
    NR > 1 && !seen[$1]++ && $1 ~ /^[a-z]/ {
      printf "%s\t%s\t%s\n", $1, $(NF-4), $(NF-1)
    }
  ')

  printf ']'
}

# macOS ping: -c count, -t deadline (seconds), -q quiet.
# Returns "lat_ms loss_pct"; both fields are valid JSON numeric tokens (or `null`).
ping_stats() {
  local target="$1"
  local out
  out=$(ping -c 4 -t 5 -q "$target" 2>/dev/null) || { echo "null 100"; return; }
  local loss avg
  # Both Linux and macOS print "X% packet loss" or "X.X% packet loss".
  loss=$(echo "$out" | awk -F',' '/packet loss/ {
    for (i=1;i<=NF;i++) if ($i ~ /packet loss/) { gsub(/[^0-9.]/, "", $i); print $i }
  }')
  # macOS: "round-trip min/avg/max/stddev = .../.../.../... ms"
  avg=$(echo "$out" | awk -F'[/=]' '/min\/avg\/max/ { print $5 }')
  if [[ ! "$avg" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then avg=null; fi
  if [[ ! "$loss" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then loss=100; fi
  echo "$avg $loss"
}

# traceroute is built-in on macOS at /usr/sbin/traceroute. Same flag semantics.
do_traceroute() {
  local target="$1"
  if ! command -v traceroute >/dev/null 2>&1; then
    printf '{"hops":[],"target":"%s","duration_ms":0,"raw":"traceroute not available"}' \
      "$(json_escape "$target")"
    return
  fi
  local raw start end duration_ms hops
  start=$(date +%s)
  raw=$(traceroute -n -q 3 -w 1 -m 30 "$target" 2>&1 | tail -n +2)
  end=$(date +%s)
  duration_ms=$(( (end - start) * 1000 ))

  hops=$(echo "$raw" | awk '
    BEGIN { ORS=""; first=1 }
    {
      hop = $1
      if (hop !~ /^[0-9]+$/) next
      ip_part = $2
      lats = ""; n = 0
      if (ip_part == "*") {
        ip_json = "null"; lats = "null,null,null"
      } else {
        ip_json = "\"" ip_part "\""
        for (i = 3; i <= NF; i++) {
          if ($i ~ /^[0-9]+(\.[0-9]+)?$/ && n < 3) {
            if (n > 0) lats = lats ","
            lats = lats $i; n++
          }
        }
        while (n < 3) { if (n > 0) lats = lats ","; lats = lats "null"; n++ }
      }
      if (!first) print ","
      first = 0
      printf "{\"n\":%s,\"ip\":%s,\"latencies_ms\":[%s]}", hop, ip_json, lats
    }
  ')
  printf '{"hops":[%s],"target":"%s","duration_ms":%d}' "$hops" "$(json_escape "$target")" "$duration_ms"
}

COMMANDS_URL="${MONITOR_INGEST_URL%/api/ingest}/api/commands"

poll_and_run_commands() {
  local response payload
  response=$(curl -sS --max-time 10 \
    -H "X-API-Key: $MONITOR_API_KEY" \
    "${COMMANDS_URL}/pending?host_id=$MONITOR_HOST_ID&fmt=tsv" 2>/dev/null) || return 0

  while IFS='|' read -r cmd_id kind target; do
    [[ -z "$cmd_id" ]] && continue
    case "$kind" in
      traceroute)
        local result
        result=$(do_traceroute "$target")
        payload=$(printf '{"status":"completed","result":%s}' "$result")
        ;;
      *)
        payload=$(printf '{"status":"failed","error":"unknown kind: %s"}' "$(json_escape "$kind")")
        ;;
    esac
    curl -sS --max-time 15 \
      -H "Content-Type: application/json" \
      -H "X-API-Key: $MONITOR_API_KEY" \
      -X POST -d "$payload" \
      "${COMMANDS_URL}/${cmd_id}/result" >/dev/null || true
  done <<< "$response"
}

# Seed throughput baseline; first iteration's interface deltas would be 0.
interfaces_json >/dev/null

while :; do
  cpu=$(cpu_usage)
  ram=$(ram_usage)
  disk=$(disk_usage)
  pcount=$(process_count)
  top_cpu=$(top_procs cpu)
  top_ram=$(top_procs mem)
  ifaces=$(interfaces_json)
  read -r ping_lat ping_loss < <(ping_stats "$MONITOR_PING_TARGET")

  payload=$(printf '{"host_id":"%s","cpu_usage":%s,"ram_usage":%s,"disk_usage":%s,"process_count":%s,"top_cpu_processes":%s,"top_ram_processes":%s,"interfaces":%s,"ping_latency_ms":%s,"ping_loss_pct":%s,"ping_target":"%s"}' \
    "$MONITOR_HOST_ID" "$cpu" "$ram" "$disk" "$pcount" "$top_cpu" "$top_ram" "$ifaces" "$ping_lat" "$ping_loss" "$(json_escape "$MONITOR_PING_TARGET")")

  http_code=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $MONITOR_API_KEY" \
    -X POST -d "$payload" \
    "$MONITOR_INGEST_URL" 2>/dev/null || echo "000")
  case "$http_code" in
    2*) ;;
    *) echo "monitor: ingest failed (HTTP $http_code)" >&2 ;;
  esac

  poll_and_run_commands

  # ping spent ~5s, leave the rest of the interval idle. Clamp to a 1s
  # minimum so MONITOR_INTERVAL=3 doesn't pass `sleep -2`.
  remaining=$(( MONITOR_INTERVAL - 5 ))
  (( remaining < 1 )) && remaining=1
  sleep "$remaining"
done
AGENT
chmod +x "$INSTALL_DIR/agent.sh"

# ─── env file ───────────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/agent.env" <<EOF
MONITOR_HOST_ID=$HOST_ID
MONITOR_API_KEY=$API_KEY
MONITOR_INGEST_URL=$INGEST_URL
MONITOR_INTERVAL=$INTERVAL
MONITOR_PING_TARGET=$PING_TARGET
EOF
chmod 600 "$INSTALL_DIR/agent.env"

# ─── launchd plist ──────────────────────────────────────────────────────────
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.monitor.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>set -a; source $INSTALL_DIR/agent.env; exec $INSTALL_DIR/agent.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin</string>
    </dict>
</dict>
</plist>
EOF
chmod 644 "$PLIST"

# Modern launchctl bootstrap; bootout first (idempotent re-install).
# Use the service-spec form `system/<label>` — older macOS silently fails when
# given a plist path here, leaving two copies of the daemon running.
launchctl bootout system/com.monitor.agent 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable system/com.monitor.agent
launchctl kickstart -k system/com.monitor.agent

echo "monitor: installed and running. Logs: tail -f $LOG"
echo "         Stop with: sudo launchctl bootout system $PLIST"
