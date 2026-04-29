#!/usr/bin/env bash
# Monitor — Linux agent installer.
# Templated by /api/install/[host_id]; placeholders are replaced server-side.
# Standalone: set MONITOR_HOST_ID, MONITOR_API_KEY, MONITOR_INGEST_URL.

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

INSTALL_DIR=/opt/monitor-agent
SERVICE=/etc/systemd/system/monitor-agent.service
mkdir -p "$INSTALL_DIR"

# ─── agent script ───────────────────────────────────────────────────────────
cat > "$INSTALL_DIR/agent.sh" <<'AGENT'
#!/usr/bin/env bash
set -uo pipefail

# JSON string-escape (handles backslash, quote, newline, tab, control chars).
json_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  printf '%s' "$s"
}

cpu_usage() {
  # /proc/stat columns: user nice system idle iowait irq softirq steal guest guest_nice
  # We must sum ALL of them into "total" — under heavy iowait the previous
  # 4-column read inflated CPU% because iowait wasn't counted in total.
  local _label u1 n1 s1 idle1 io1 irq1 sirq1 st1 g1 gn1
  local _label2 u2 n2 s2 idle2 io2 irq2 sirq2 st2 g2 gn2
  read -r _label u1 n1 s1 idle1 io1 irq1 sirq1 st1 g1 gn1 < /proc/stat
  sleep 1
  read -r _label2 u2 n2 s2 idle2 io2 irq2 sirq2 st2 g2 gn2 < /proc/stat
  : "${io1:=0}" "${irq1:=0}" "${sirq1:=0}" "${st1:=0}" "${g1:=0}" "${gn1:=0}"
  : "${io2:=0}" "${irq2:=0}" "${sirq2:=0}" "${st2:=0}" "${g2:=0}" "${gn2:=0}"
  local total1=$((u1 + n1 + s1 + idle1 + io1 + irq1 + sirq1 + st1))
  local total2=$((u2 + n2 + s2 + idle2 + io2 + irq2 + sirq2 + st2))
  local dt=$((total2 - total1))
  # idle for accounting purposes = idle + iowait (kernel convention).
  local di=$(( (idle2 + io2) - (idle1 + io1) ))
  if (( dt <= 0 )); then echo "0"; return; fi
  awk -v dt="$dt" -v di="$di" 'BEGIN { printf "%.1f", (dt - di) * 100.0 / dt }'
}

ram_usage() {
  awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END { if (t>0) printf "%.1f", (t-a)*100.0/t; else print "0" }' /proc/meminfo
}

disk_usage() {
  df -P / | awk 'NR==2 { gsub("%","",$5); print $5 }'
}

process_count() {
  ps -e --no-headers 2>/dev/null | wc -l
}

# Top N processes by a sort key (%cpu or %mem). Outputs JSON array.
top_procs() {
  local key="$1"  # %cpu or %mem
  ps -eo pid,%cpu,%mem,comm --no-headers --sort=-${key} 2>/dev/null | head -5 | awk '
    BEGIN { ORS=""; print "[" }
    {
      if (count++ > 0) print ","
      gsub(/\\/, "\\\\", $4); gsub(/"/, "\\\"", $4)
      printf "{\"pid\":%d,\"cpu_pct\":%.1f,\"ram_pct\":%.1f,\"name\":\"%s\"}", $1, $2, $3, $4
    }
    END { print "]" }
  '
}

# Interfaces — emit JSON array. Throughput is delta from prev sample over $1 seconds.
declare -A PREV_RX PREV_TX
PREV_TS=0
interfaces_json() {
  local now dt
  now=$(date +%s)
  if (( PREV_TS == 0 )); then dt=0; else dt=$((now - PREV_TS)); fi
  PREV_TS=$now

  local first=1
  printf '['
  while IFS=':' read -r raw rest; do
    local iface
    iface=$(echo "$raw" | tr -d ' ')
    [[ -z "$iface" || "$iface" == "lo" || "$iface" == Inter* || "$iface" == face* ]] && continue
    local rx tx
    rx=$(echo "$rest" | awk '{print $1}')
    tx=$(echo "$rest" | awk '{print $9}')

    local rx_bps=0 tx_bps=0
    if (( dt > 0 )) && [[ -n "${PREV_RX[$iface]:-}" ]]; then
      rx_bps=$(( (rx - PREV_RX[$iface]) / dt ))
      tx_bps=$(( (tx - PREV_TX[$iface]) / dt ))
      (( rx_bps < 0 )) && rx_bps=0
      (( tx_bps < 0 )) && tx_bps=0
    fi
    PREV_RX[$iface]=$rx
    PREV_TX[$iface]=$tx

    local state status mac ip
    state=$(cat "/sys/class/net/$iface/operstate" 2>/dev/null || echo unknown)
    status="unknown"
    [[ "$state" == "up"   ]] && status="up"
    [[ "$state" == "down" ]] && status="down"
    mac=$(cat "/sys/class/net/$iface/address" 2>/dev/null || echo "")
    ip=$(ip -4 -o addr show "$iface" 2>/dev/null | awk '{print $4}' | head -1 | sed 's|/.*||')

    (( first )) || printf ','
    first=0
    printf '{"name":"%s","status":"%s","rx_bps":%d,"tx_bps":%d,"mac":"%s","ip":"%s"}' \
      "$(json_escape "$iface")" "$status" "$rx_bps" "$tx_bps" \
      "$(json_escape "$mac")" "$(json_escape "$ip")"
  done < <(grep ":" /proc/net/dev)
  printf ']'
}

# ICMP ping; returns "lat_ms loss_pct" on stdout. Both fields are guaranteed
# to be valid JSON numeric tokens (bare number) or the literal `null`.
ping_stats() {
  local target="$1"
  local out
  out=$(ping -c 4 -W 1 -q "$target" 2>/dev/null) || { echo "null 100"; return; }
  local loss avg
  loss=$(echo "$out" | awk -F',' '/packet loss/ { for (i=1;i<=NF;i++) if ($i ~ /packet loss/) { gsub(/[^0-9.]/, "", $i); print $i } }')
  avg=$(echo "$out" | awk -F'[/=]' '/min\/avg\/max/ { print $5 }')
  # Validate: a malformed avg (e.g. comma-decimal locale "1,234") would emit
  # invalid JSON like `1,234`. Fall back to null when the parse looks wrong.
  if [[ ! "$avg" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then avg=null; fi
  if [[ ! "$loss" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then loss=100; fi
  echo "$avg $loss"
}

# Commands base URL is the same site as ingest, different path.
COMMANDS_URL="${MONITOR_INGEST_URL%/api/ingest}/api/commands"

# Run a traceroute and emit a JSON object: { hops:[...], target, duration_ms }.
do_traceroute() {
  local target="$1"
  if ! command -v traceroute >/dev/null 2>&1; then
    printf '{"hops":[],"target":"%s","duration_ms":0,"raw":"traceroute not installed (apt install traceroute)"}' \
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

# Poll for and execute pending commands targeted at this host.
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

# First call seeds throughput baseline; data from this is dropped.
interfaces_json >/dev/null

while :; do
  cpu=$(cpu_usage)
  ram=$(ram_usage)
  disk=$(disk_usage)
  pcount=$(process_count)
  top_cpu=$(top_procs %cpu)
  top_ram=$(top_procs %mem)
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

  # Drain any queued commands. Runs synchronously — a slow traceroute will
  # delay the next metric tick by a few seconds, which is acceptable.
  poll_and_run_commands

  # cpu_usage already slept ~1s, ping ~4s, leave the rest of the interval idle.
  # Clamp to a 1s minimum so MONITOR_INTERVAL=3 doesn't pass `sleep -2`.
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

# ─── systemd unit ───────────────────────────────────────────────────────────
cat > "$SERVICE" <<EOF
[Unit]
Description=Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=$INSTALL_DIR/agent.env
ExecStart=$INSTALL_DIR/agent.sh
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now monitor-agent.service
echo "monitor: installed and running. Status: systemctl status monitor-agent"
