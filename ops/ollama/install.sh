#!/usr/bin/env bash
set -euo pipefail

host="127.0.0.1:11434"

if [ "$(uname -s)" = "Linux" ] && ! grep -qw avx2 /proc/cpuinfo; then
  echo "AVX2 is not available on this CPU" >&2
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/fab5.conf >/dev/null <<UNIT
[Service]
Environment="OLLAMA_HOST=${host}"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_MAX_LOADED_MODELS=2"
Environment="OLLAMA_NUM_PARALLEL=1"
Nice=5
UNIT
  sudo systemctl daemon-reload
  sudo systemctl enable ollama
  sudo systemctl restart ollama
elif ! curl -fsS "http://${host}/api/version" >/dev/null 2>&1; then
  OLLAMA_HOST="${host}" OLLAMA_KEEP_ALIVE=-1 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_NUM_PARALLEL=1 nohup ollama serve >/tmp/ollama.log 2>&1 &
fi

for _ in $(seq 1 30); do
  if curl -fsS "http://${host}/api/version"; then
    echo
    exit 0
  fi
  sleep 2
done

echo "Ollama did not become reachable on ${host}" >&2
exit 1
