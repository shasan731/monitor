# Monitor - Windows agent installer.
# Templated by /api/install/[host_id]; placeholders are replaced server-side.
# Run from an elevated PowerShell:
#   iwr -useb <install-url> | iex

$ErrorActionPreference = "Stop"

$HostId      = $env:MONITOR_HOST_ID      ; if (-not $HostId)      { $HostId      = "__HOST_ID__" }
$ApiKey      = $env:MONITOR_API_KEY      ; if (-not $ApiKey)      { $ApiKey      = "__API_KEY__" }
$IngestUrl   = $env:MONITOR_INGEST_URL   ; if (-not $IngestUrl)   { $IngestUrl   = "__INGEST_URL__" }
$PingTarget  = if ($env:MONITOR_PING_TARGET) { $env:MONITOR_PING_TARGET } else { "1.1.1.1" }
$Interval    = if ($env:MONITOR_INTERVAL) { [int]$env:MONITOR_INTERVAL } else { 60 }

if ($HostId -like "__*" -or $ApiKey -like "__*" -or $IngestUrl -like "__*") {
  Write-Error "monitor: missing config - re-run via the install URL"
  exit 1
}

$identity  = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "monitor: must run from an elevated (Administrator) PowerShell"
  exit 1
}

$Root = "$env:ProgramData\MonitorAgent"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

# ── agent script ────────────────────────────────────────────────────────────
$Agent = @'
param(
  [Parameter(Mandatory)] [string] $HostId,
  [Parameter(Mandatory)] [string] $ApiKey,
  [Parameter(Mandatory)] [string] $IngestUrl,
  [Parameter(Mandatory)] [int]    $Interval,
  [Parameter(Mandatory)] [string] $PingTarget
)

$ErrorActionPreference = "SilentlyContinue"

# Optional: set MONITOR_LOG=1 to capture stdout/stderr to ProgramData. Rotated
# crudely by truncating once it crosses ~5MB so it can't fill the disk.
if ($env:MONITOR_LOG -eq "1") {
  $LogPath = Join-Path $env:ProgramData "MonitorAgent\agent.log"
  try {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 5MB) {
      Set-Content -Path $LogPath -Value "" -Encoding UTF8
    }
    Start-Transcript -Path $LogPath -Append -Force | Out-Null
  } catch { }
}

# Carry per-process CPU time across iterations to compute %.
$prevCpu      = @{}
$prevCpuTime  = $null
$prevIfStats  = @{}
$prevIfTime   = $null
$cores        = [Environment]::ProcessorCount
if (-not $cores -or $cores -lt 1) { $cores = 1 }

function Get-CpuOverall {
  $samples = Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 2 |
             Select-Object -ExpandProperty CounterSamples
  if (-not $samples) { return 0 }
  ($samples | Measure-Object -Property CookedValue -Average).Average
}

function Get-RamUsedPct {
  $os = Get-CimInstance Win32_OperatingSystem
  if (-not $os -or $os.TotalVisibleMemorySize -eq 0) { return 0 }
  100 - (($os.FreePhysicalMemory / $os.TotalVisibleMemorySize) * 100)
}

function Get-DiskUsedPct {
  $sysDrive = ($env:SystemDrive).TrimEnd(':')
  $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($sysDrive):'"
  if (-not $d -or $d.Size -eq 0) { return 0 }
  100 - (($d.FreeSpace / $d.Size) * 100)
}

function Get-TopProcesses {
  $totalRamKB = (Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize
  $totalRamBytes = [double]$totalRamKB * 1024
  $now = Get-Date
  $procs = Get-Process

  # Rebuild prevCpu from this iteration's PIDs only — dead processes get
  # evicted automatically, so the hashtable can't grow unbounded over weeks.
  $nextPrev = @{}
  $rows = @()
  foreach ($p in $procs) {
    $cpuPct = 0
    if ($script:prevCpuTime -ne $null -and $p.CPU -ne $null -and $script:prevCpu.ContainsKey($p.Id)) {
      $deltaSec = ($now - $script:prevCpuTime).TotalSeconds
      if ($deltaSec -gt 0) {
        $cpuPct = (($p.CPU - $script:prevCpu[$p.Id]) / $deltaSec / $cores) * 100
        if ($cpuPct -lt 0) { $cpuPct = 0 }
        if ($cpuPct -gt 100) { $cpuPct = 100 }
      }
    }
    if ($p.CPU -ne $null) { $nextPrev[$p.Id] = $p.CPU }
    $ramPct = if ($totalRamBytes -gt 0) { ($p.WorkingSet64 / $totalRamBytes) * 100 } else { 0 }
    $rows += [PSCustomObject]@{
      pid     = $p.Id
      name    = $p.ProcessName
      cpu_pct = [math]::Round($cpuPct, 1)
      ram_pct = [math]::Round($ramPct, 1)
    }
  }
  $script:prevCpu     = $nextPrev
  $script:prevCpuTime = $now

  return @{
    count   = $procs.Count
    top_cpu = $rows | Sort-Object cpu_pct -Descending | Select-Object -First 5
    top_ram = $rows | Sort-Object ram_pct -Descending | Select-Object -First 5
  }
}

function Get-Interfaces {
  $now = Get-Date
  $adapters = Get-NetAdapter -ErrorAction SilentlyContinue
  $stats    = Get-NetAdapterStatistics -ErrorAction SilentlyContinue
  $statsByName = @{}
  foreach ($s in $stats) { $statsByName[$s.Name] = $s }

  $nextPrev = @{}
  $ifaces = @()
  foreach ($a in $adapters) {
    $rxBps = 0; $txBps = 0
    $s = $statsByName[$a.Name]
    if ($s -and $script:prevIfTime -ne $null -and $script:prevIfStats.ContainsKey($a.Name)) {
      $dt = ($now - $script:prevIfTime).TotalSeconds
      if ($dt -gt 0) {
        $rxBps = [math]::Max(0, ($s.ReceivedBytes - $script:prevIfStats[$a.Name].rx) / $dt)
        $txBps = [math]::Max(0, ($s.SentBytes     - $script:prevIfStats[$a.Name].tx) / $dt)
      }
    }
    if ($s) {
      $nextPrev[$a.Name] = @{ rx = $s.ReceivedBytes; tx = $s.SentBytes }
    }

    $status = "unknown"
    if ($a.Status -eq "Up")   { $status = "up" }
    elseif ($a.Status -eq "Disabled" -or $a.Status -eq "Disconnected" -or $a.Status -eq "Down") { $status = "down" }

    $ip = (Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
           Select-Object -First 1).IPAddress

    $ifaces += [PSCustomObject]@{
      name    = $a.Name
      status  = $status
      rx_bps  = [int][math]::Round($rxBps)
      tx_bps  = [int][math]::Round($txBps)
      mac     = $a.MacAddress
      ip      = $ip
    }
  }
  $script:prevIfStats = $nextPrev
  $script:prevIfTime  = $now
  return ,$ifaces
}

function Get-PingStats {
  param([string] $Target)
  try {
    $r = Test-Connection -ComputerName $Target -Count 4 -ErrorAction Stop
    $all = @($r)
    $sent = 4
    # Filter to successful pings only — Test-Connection returns rows with
    # StatusCode != 0 and ResponseTime == 0 for losses; including those in
    # the average drags it toward 0 and under-reports real latency.
    $ok  = @($all | Where-Object { $_.StatusCode -eq 0 })
    $received = $ok.Count
    $loss     = (($sent - $received) / $sent) * 100
    if ($received -gt 0) {
      $avg = ($ok | Measure-Object -Property ResponseTime -Average).Average
      return @{ latency = [math]::Round([double]$avg, 1); loss = [math]::Round($loss, 1) }
    } else {
      return @{ latency = $null; loss = [math]::Round($loss, 1) }
    }
  } catch {
    return @{ latency = $null; loss = 100 }
  }
}

# Run tracert.exe and parse its output into a structured hops array.
# NOTE: parser assumes English Windows UI strings ("ms", numeric latency tokens).
# On localised Windows installs the latency regex may not match — document this
# in the README, or install the English language pack to enable parsing.
function Invoke-Traceroute {
  param([string] $Target)
  $start = Get-Date
  # tracert.exe does not understand `--`; rely on PowerShell argument quoting.
  # The caller already validates $Target against TARGET_RE upstream.
  $output = & tracert.exe -d -h 30 -w 1000 $Target 2>&1 | Out-String
  $duration = ((Get-Date) - $start).TotalMilliseconds

  $hops = @()
  foreach ($line in ($output -split "`r?`n")) {
    if ($line -notmatch '^\s*(\d+)\s+(.+)$') { continue }
    $n = [int]$matches[1]
    $rest = $matches[2]

    $lats = @()
    while ($lats.Count -lt 3 -and $rest -match '^\s*(<?\s*\d+\s*ms|\*)\s+') {
      $tok = $matches[1].Trim()
      if ($tok -eq '*') {
        $lats += $null
      } elseif ($tok -match '<') {
        $lats += 1.0   # "<1 ms" — call it 1ms
      } elseif ($tok -match '(\d+(?:\.\d+)?)') {
        $lats += [double]$matches[1]
      } else {
        $lats += $null
      }
      $rest = $rest -replace '^\s*(<?\s*\d+\s*ms|\*)\s+', ''
    }
    while ($lats.Count -lt 3) { $lats += $null }

    $ip = $null
    if ($rest -match '(\d+\.\d+\.\d+\.\d+)') { $ip = $matches[1] }

    $hops += [PSCustomObject]@{
      n            = $n
      ip           = $ip
      latencies_ms = @($lats[0], $lats[1], $lats[2])
    }
  }

  return @{
    hops        = $hops
    target      = $Target
    duration_ms = [int]$duration
  }
}

# Poll the commands API and run any pending command for this host.
$CommandsUrl = ($IngestUrl -replace '/api/ingest$','') + '/api/commands'

function Invoke-CommandsPoll {
  try {
    $resp = Invoke-RestMethod -Uri "$CommandsUrl/pending?host_id=$HostId" -Method Get `
      -Headers @{ "X-API-Key" = $ApiKey } -TimeoutSec 10
  } catch {
    return
  }
  if (-not $resp -or -not $resp.commands) { return }

  foreach ($cmd in $resp.commands) {
    $payload = $null
    try {
      switch ($cmd.kind) {
        'traceroute' {
          $result  = Invoke-Traceroute -Target $cmd.target
          $payload = @{ status = 'completed'; result = $result } | ConvertTo-Json -Depth 6 -Compress
        }
        default {
          $payload = @{ status = 'failed'; error = "unknown kind: $($cmd.kind)" } | ConvertTo-Json -Compress
        }
      }
    } catch {
      $payload = @{ status = 'failed'; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress
    }

    try {
      Invoke-RestMethod -Uri "$CommandsUrl/$($cmd.id)/result" -Method Post -Body $payload `
        -Headers @{ "X-API-Key" = $ApiKey; "Content-Type" = "application/json" } `
        -TimeoutSec 15 | Out-Null
    } catch { }
  }
}

# Seed deltas — first iteration's network/CPU% values will be 0.
$null = Get-TopProcesses
$null = Get-Interfaces

while ($true) {
  try {
    $cpu  = Get-CpuOverall
    $ram  = Get-RamUsedPct
    $disk = Get-DiskUsedPct
    $procs = Get-TopProcesses
    $ifaces = Get-Interfaces
    $ping = Get-PingStats -Target $PingTarget

    $payloadObj = @{
      host_id           = $HostId
      cpu_usage         = [math]::Round([double]$cpu, 1)
      ram_usage         = [math]::Round([double]$ram, 1)
      disk_usage        = [math]::Round([double]$disk, 1)
      process_count     = [int]$procs.count
      top_cpu_processes = @($procs.top_cpu)
      top_ram_processes = @($procs.top_ram)
      interfaces        = @($ifaces)
      ping_latency_ms   = $ping.latency
      ping_loss_pct     = $ping.loss
      ping_target       = $PingTarget
    }
    $payload = $payloadObj | ConvertTo-Json -Depth 5 -Compress

    try {
      $resp = Invoke-WebRequest -Uri $IngestUrl -Method Post -Body $payload `
        -Headers @{ "X-API-Key" = $ApiKey; "Content-Type" = "application/json" } `
        -TimeoutSec 15 -UseBasicParsing
      if ($resp.StatusCode -lt 200 -or $resp.StatusCode -ge 300) {
        Write-Warning "monitor: ingest returned HTTP $($resp.StatusCode)"
      }
    } catch {
      Write-Warning "monitor: ingest failed - $($_.Exception.Message)"
    }
  } catch {
    # Swallow errors so the loop never dies. Service will restart on real crash.
  }

  # Drain any queued commands. Synchronous — a slow traceroute delays
  # the next metric tick by a few seconds, which is acceptable.
  Invoke-CommandsPoll

  Start-Sleep -Seconds $Interval
}
'@

$AgentPath = Join-Path $Root "agent.ps1"
Set-Content -Path $AgentPath -Value $Agent -Encoding UTF8

# ── scheduled task that survives reboots ────────────────────────────────────
$TaskName = "MonitorAgent"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

$psArgs  = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$AgentPath`" " +
           "-HostId `"$HostId`" -ApiKey `"$ApiKey`" -IngestUrl `"$IngestUrl`" -Interval $Interval -PingTarget `"$PingTarget`""

$action     = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $psArgs
$trigger    = New-ScheduledTaskTrigger -AtStartup
$principalT = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
              -ExecutionTimeLimit (New-TimeSpan -Days 0)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principalT -Settings $settings -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "monitor: installed and running. Manage with: Get-ScheduledTask MonitorAgent"
