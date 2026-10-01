import { mkdirSync, writeFileSync } from 'node:fs';

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error('RESEND_API_KEY required');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const items = [];
let after;

for (let page = 0; page < 200; page += 1) {
  const url = new URL('https://api.resend.com/emails');
  url.searchParams.set('limit', '100');
  if (after) url.searchParams.set('after', after);
  const res = await fetch(url, { headers });
  if (res.status === 429) {
    await sleep(1500);
    page -= 1;
    continue;
  }
  if (!res.ok) {
    console.error(res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  const data = body.data ?? [];
  items.push(
    ...data.map((e) => ({
      id: e.id,
      created_at: e.created_at,
      subject: e.subject,
      last_event: e.last_event,
    })),
  );
  if (!body.has_more || data.length === 0) break;
  after = data[data.length - 1].id;
  await sleep(600);
}

const times = items
  .map((e) => new Date(e.created_at).getTime())
  .filter(Number.isFinite)
  .sort((a, b) => a - b);
const oldest = times.length ? new Date(times[0]).toISOString() : null;
const newest = times.length ? new Date(times[times.length - 1]).toISOString() : null;
const observedRetentionDays = oldest ? Math.ceil((Date.now() - times[0]) / 86400000) : 0;

mkdirSync('ops', { recursive: true });
writeFileSync(
  'ops/resend-export.json',
  JSON.stringify({ exportedAt: new Date().toISOString(), count: items.length, items }, null, 2),
);
console.log(
  JSON.stringify({ count: items.length, oldest, newest, observedRetentionDays }, null, 2),
);
