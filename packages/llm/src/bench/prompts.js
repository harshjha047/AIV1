export const COMMENTARY_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    commentary: { type: 'string' },
    flags: { type: 'array', items: { type: 'string' } }
  },
  required: ['commentary', 'flags'],
  additionalProperties: false
});

const SYSTEM =
  'You write one short paragraph of commentary for an employee KPI card. Use only the numbers given. Never invent numbers or causes. Copy flags only from the allowed list.';

export function commentaryMessages(fact) {
  const lines = fact.metrics.map((metric) => `- ${metric.label}: ${metric.display}`).join('\n');
  const flags = fact.flags.length > 0 ? fact.flags.join(', ') : 'none';
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Profile: ${fact.profile}\nPeriod: ${fact.period}\nFacts:\n${lines}\nAllowed flags: ${flags}\nReturn JSON with commentary (at most 60 words) and flags.`
    }
  ];
}

const FILLER = 'Ticket summary: circuit alarm raised, field engineer assigned, telco confirmed fibre maintenance window, customer informed. ';

export function prefillMessages(targetTokens, nonce) {
  const repeats = Math.max(1, Math.ceil((targetTokens * 4) / FILLER.length));
  return [
    { role: 'system', content: `Reference ${nonce}. Reply with the single word ok.` },
    { role: 'user', content: `${FILLER.repeat(repeats)}\nReply with ok.` }
  ];
}

export function decodeMessages(nonce) {
  return [
    { role: 'system', content: `Reference ${nonce}.` },
    { role: 'user', content: 'Write a long plain paragraph about how a support team can reduce ticket resolution time. Keep writing until stopped.' }
  ];
}
