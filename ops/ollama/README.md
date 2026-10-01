# Ollama setup and model benchmark (P1-12)

All inference runs on the local Ollama instance at `127.0.0.1:11434`. The client refuses any other host.

## Install

Windows (VPS or laptop), run in an elevated PowerShell with NSSM on the path:

```
powershell -ExecutionPolicy Bypass -File ops/ollama/install.ps1
```

Parameters: `-Affinity 4-7` (verify with `nssm get OllamaSvc AppAffinity`), `-SkipService` for a laptop without NSSM. The script fails when AVX2 is not exposed to the machine. After installing, confirm that the model-runner child process inherits the priority and affinity (`Get-Process`; process names vary by Ollama version).

Linux or macOS:

```
bash ops/ollama/install.sh
```

The service runs with `OLLAMA_KEEP_ALIVE=-1`, `OLLAMA_MAX_LOADED_MODELS=2`, `OLLAMA_NUM_PARALLEL=1`.

## Candidates

`ops/ollama/candidates.json` lists tags per role. Verify that each tag exists in the Ollama library before running; missing tags are reported as `skipped`. Entries may carry `"think": false` for models that expose a thinking mode.

## Benchmark

```
npm run bench:models -- --pull --runs 3 --pin
```

Options: `--only small,large,embed`, `--candidates <file>`, `--out <dir>`, `--env <file>`, `--allow-partial`.

For each installed candidate the harness records:

- load time and resident model size (`/api/ps`) plus the drop in host free memory;
- prefill speed (about 1500-token prompts, unique prefix so the cache is not reused);
- decode speed (200 tokens);
- time to first token and total time over six sample KPI fact sets, each repeated `--runs` times, with structured output;
- quality: schema validity, number grounding (every number in the commentary must come from the facts or a lakh/crore/thousand form of them), allowed flags only, length;
- for embeddings: dimension, batch time, and retrieval@1 on three query and document sets with the `search_query:` and `search_document:` prefixes.

Reports are written to `ops/benchmarks/<timestamp>.json` and `.md`.

## Pinning rule

A chat model qualifies when quality is at least 0.85, grounding at least 0.90, schema validity at least 0.95 and the failure rate at most 0.10. `MODEL_SMALL` is the fastest decoder among qualifying small candidates. `MODEL_LARGE` is the highest quality among qualifying large candidates. `MODEL_EMBED` is the best retrieval@1 with the expected 768 dimensions. With `--pin`, `ops/ollama/models.env` receives the three tags; exit code 2 means some role had no qualifying model.

Laptop figures are baselines, not production targets; rerun on the VPS in Phase 5.
