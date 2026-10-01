$ErrorActionPreference = 'Stop'

function Get-Version([string]$Command, [string[]]$VersionArgs) {
  try { (& $Command @VersionArgs 2>&1 | Select-Object -First 1).ToString().Trim() } catch { $null }
}

Add-Type -Namespace Native -Name Cpu -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int f);'

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$samples = 1..12 | ForEach-Object {
  $c = (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue
  Start-Sleep -Seconds 5
  [math]::Round($c, 1)
}
$pm2 = $null
try { $pm2 = (pm2 jlist | ConvertFrom-Json) | ForEach-Object { [pscustomobject]@{ name = $_.name; mode = $_.pm2_env.exec_mode; instances = $_.pm2_env.instances; memoryMb = [math]::Round($_.monit.memory / 1MB, 1); cpu = $_.monit.cpu } } } catch {}

$listeners = Get-NetTCPConnection -State Listen | Sort-Object LocalPort | ForEach-Object {
  $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [pscustomobject]@{ address = $_.LocalAddress; port = $_.LocalPort; process = $p.ProcessName }
}

$nginxConf = Get-ChildItem -Path 'C:\nginx*', 'C:\Program Files\nginx*' -Recurse -Filter 'nginx.conf' -ErrorAction SilentlyContinue | Select-Object -First 1

$baseline = [ordered]@{
  collectedAt = (Get-Date).ToUniversalTime().ToString('o')
  hostname = $env:COMPUTERNAME
  os = $os.Caption
  osBuild = $os.BuildNumber
  cpu = [ordered]@{
    name = $cpu.Name
    physicalCores = ($cpu | Measure-Object NumberOfCores -Sum).Sum
    logicalProcessors = ($cpu | Measure-Object NumberOfLogicalProcessors -Sum).Sum
    avx2 = [Native.Cpu]::IsProcessorFeaturePresent(40)
    avx512 = [Native.Cpu]::IsProcessorFeaturePresent(41)
    loadSamplesPct = $samples
    loadAvgPct = [math]::Round(($samples | Measure-Object -Average).Average, 1)
    loadMaxPct = ($samples | Measure-Object -Maximum).Maximum
  }
  memory = [ordered]@{
    totalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
    freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
  }
  versions = [ordered]@{
    node = Get-Version 'node' @('-v')
    npm = Get-Version 'npm' @('-v')
    mongod = Get-Version 'mongod' @('--version')
    redis = Get-Version 'redis-server' @('--version')
    postgres = Get-Version 'psql' @('--version')
    pm2 = Get-Version 'pm2' @('-v')
    nginx = Get-Version 'nginx' @('-v')
    ollama = Get-Version 'ollama' @('--version')
  }
  pm2Processes = $pm2
  listeners = $listeners
  nginxConfigPath = if ($nginxConf) { $nginxConf.FullName } else { $null }
}

New-Item -ItemType Directory -Force -Path ops | Out-Null
$baseline | ConvertTo-Json -Depth 6 | Set-Content -Path ops/baseline.json -Encoding utf8
if ($nginxConf) { Copy-Item $nginxConf.FullName ops/nginx.conf.snapshot -Force }
pm2 save --force 2>$null
if (Test-Path "$env:USERPROFILE\.pm2\dump.pm2") { Copy-Item "$env:USERPROFILE\.pm2\dump.pm2" ops/pm2.dump.snapshot -Force }
$baseline | ConvertTo-Json -Depth 6
