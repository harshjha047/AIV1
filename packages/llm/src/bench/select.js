export const DEFAULT_GATES = Object.freeze({
  minQuality: 0.85,
  minGrounding: 0.9,
  minSchemaValid: 0.95,
  maxFailureRate: 0.1,
  minRetrieval: 0.66
});

const better = (a, b, key) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity);

function passesChat(entry, gates) {
  return (
    entry.status === 'ok' &&
    (entry.quality.score ?? 0) >= gates.minQuality &&
    (entry.quality.groundingRate ?? 0) >= gates.minGrounding &&
    (entry.quality.schemaValidRate ?? 0) >= gates.minSchemaValid &&
    (entry.quality.failureRate ?? 1) <= gates.maxFailureRate
  );
}

export function selectPins(report, gates = DEFAULT_GATES) {
  const results = report.results;
  const small = results
    .filter((entry) => entry.role === 'small' && passesChat(entry, gates))
    .sort((a, b) => better(a, b, 'decodeTokPerSec') || (b.quality.score - a.quality.score));
  const large = results
    .filter((entry) => entry.role === 'large' && passesChat(entry, gates))
    .sort((a, b) => b.quality.score - a.quality.score || better(a, b, 'decodeTokPerSec'));
  const embed = results
    .filter((entry) => entry.role === 'embed' && entry.status === 'ok' && entry.dimOk && (entry.retrievalAt1 ?? 0) >= gates.minRetrieval)
    .sort((a, b) => b.retrievalAt1 - a.retrievalAt1 || (a.batchTotalMs.p50 ?? Infinity) - (b.batchTotalMs.p50 ?? Infinity));
  const pins = {
    MODEL_SMALL: small[0]?.tag ?? null,
    MODEL_LARGE: large[0]?.tag ?? null,
    MODEL_EMBED: embed[0]?.tag ?? null
  };
  const reasons = {
    MODEL_SMALL: small[0] ? `fastest decode among ${small.length} passing` : 'no passing candidate',
    MODEL_LARGE: large[0] ? `best quality among ${large.length} passing` : 'no passing candidate',
    MODEL_EMBED: embed[0] ? `best retrieval among ${embed.length} passing` : 'no passing candidate'
  };
  if (pins.MODEL_SMALL && pins.MODEL_SMALL === pins.MODEL_LARGE) reasons.MODEL_LARGE += ' (same tag as small)';
  return { pins, reasons, gates };
}

export function renderEnv(pins) {
  return `${Object.entries(pins)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

const cell = (value) => (value === null || value === undefined ? 'n/a' : String(value));

export function renderMarkdown(report, selection) {
  const lines = [];
  lines.push('# Model benchmark report', '');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Host: ${report.host.platform}, ${report.host.cpuModel}, ${report.host.cores} cores, ${report.host.totalMb} MB RAM`);
  lines.push(`Runs per measurement: ${report.settings.runs}. ${report.note}`, '');
  const chat = report.results.filter((entry) => entry.role !== 'embed');
  lines.push('## Chat models', '');
  lines.push('| Role | Model | Status | Prefill tok/s | Decode tok/s | TTFT p50 ms | Total p95 ms | Model MB | Quality | Grounded | Schema | Failures |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const entry of chat) {
    if (entry.status !== 'ok') {
      lines.push(`| ${entry.role} | ${entry.tag} | ${entry.status} (${entry.reason ?? entry.errorClass}) | | | | | | | | | |`);
      continue;
    }
    lines.push(
      `| ${entry.role} | ${entry.tag} | ok | ${cell(entry.prefillTokPerSec)} | ${cell(entry.decodeTokPerSec)} | ${cell(entry.ttftMs.p50)} | ${cell(entry.totalMs.p95)} | ${cell(entry.memory.modelMb)} | ${cell(entry.quality.score)} | ${cell(entry.quality.groundingRate)} | ${cell(entry.quality.schemaValidRate)} | ${cell(entry.quality.failureRate)} |`
    );
  }
  lines.push('', '## Embedding models', '');
  lines.push('| Model | Status | Dim | Batch p50 ms | Load ms | Model MB | Retrieval@1 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const entry of report.results.filter((item) => item.role === 'embed')) {
    if (entry.status !== 'ok') {
      lines.push(`| ${entry.tag} | ${entry.status} (${entry.reason ?? entry.errorClass}) | | | | | |`);
      continue;
    }
    lines.push(`| ${entry.tag} | ok | ${entry.dim}${entry.dimOk ? '' : ' (unexpected)'} | ${cell(entry.batchTotalMs.p50)} | ${cell(entry.loadMs)} | ${cell(entry.memory.modelMb)} | ${cell(entry.retrievalAt1)} |`);
  }
  lines.push('', '## Pinned tags', '');
  for (const [key, value] of Object.entries(selection.pins)) lines.push(`- ${key}: ${value ?? 'none'} (${selection.reasons[key]})`);
  lines.push('', `Gates: ${JSON.stringify(selection.gates)}`);
  return `${lines.join('\n')}\n`;
}
