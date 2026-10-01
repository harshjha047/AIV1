import { DateTime } from 'luxon';

export function parseDailyCron(expression) {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(String(expression).trim());
  if (!match) throw new TypeError(`Only "M H * * *" schedules are supported: ${expression}`);
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (minute > 59 || hour > 23) throw new TypeError(`Invalid schedule ${expression}`);
  return { minute, hour };
}

export function nextRunAt(expression, zone, from) {
  const { minute, hour } = parseDailyCron(expression);
  const local = DateTime.fromJSDate(from, { zone });
  let next = local.set({ hour, minute, second: 0, millisecond: 0 });
  if (next <= local) next = next.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 });
  return next.toUTC().toJSDate();
}

export function startVerifyScheduler({
  cron = '30 3 * * *',
  zone = 'Asia/Kolkata',
  clock,
  listSources,
  verify,
  logger,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let handle = null;
  let stopped = false;

  function schedule() {
    if (stopped) return;
    const now = clock.now();
    const delay = nextRunAt(cron, zone, now).getTime() - now.getTime();
    handle = setTimer(async () => {
      try {
        for (const source of await listSources()) {
          if (source.state === 'not_configured') continue;
          try {
            await verify(source._id);
          } catch (error) {
            logger?.error?.({ err: error.message, sourceId: source._id }, 'scheduled verify failed');
          }
        }
      } finally {
        schedule();
      }
    }, delay);
    handle?.unref?.();
  }

  schedule();
  return () => {
    stopped = true;
    if (handle) clearTimer(handle);
  };
}
