param(
  [string]$OllamaPath = "C:\Program Files\Ollama\ollama.exe",
  [string]$ServiceName = "OllamaSvc",
  [string]$Affinity = "4-7",
  [switch]$SkipService
)

$ErrorActionPreference = "Stop"

Add-Type -Namespace Fab5 -Name Cpu -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int feature);'
if (-not [Fab5.Cpu]::IsProcessorFeaturePresent(40)) {
  throw "AVX2 is not exposed to this machine. Enable it in the hypervisor before benchmarking."
}

if (-not (Test-Path $OllamaPath)) {
  winget install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
  if (-not (Test-Path $OllamaPath)) {
    $resolved = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $resolved) { throw "Ollama executable not found after install" }
    $OllamaPath = $resolved.Source
  }
}

if (-not $SkipService) {
  if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { throw "nssm is required for service installation" }
  if (-not (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)) {
    nssm install $ServiceName $OllamaPath serve
  }
  nssm set $ServiceName AppEnvironmentExtra "OLLAMA_HOST=127.0.0.1:11434" "OLLAMA_KEEP_ALIVE=-1" "OLLAMA_MAX_LOADED_MODELS=2" "OLLAMA_NUM_PARALLEL=1"
  nssm set $ServiceName AppPriority BELOW_NORMAL_PRIORITY_CLASS
  nssm set $ServiceName AppAffinity $Affinity
  nssm get $ServiceName AppAffinity
  nssm restart $ServiceName
}

$deadline = (Get-Date).AddSeconds(60)
do {
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -TimeoutSec 3
    Write-Output "ollama $($version.version) listening on 127.0.0.1:11434"
    exit 0
  } catch {
    Start-Sleep -Seconds 2
  }
} while ((Get-Date) -lt $deadline)

throw "Ollama did not become reachable on 127.0.0.1:11434"
