import { IST } from '@fab5/shared/clock';
import { allowedOutputFields, getViewAllowList } from '@fab5/shared/pii';
import { safeMessage } from '@fab5/shared/redact';
import { SourceDisabledError } from '@fab5/source-gate';
import { COUNT_MAX_TIME_MS, PROBE_MAX_TIME_MS } from './constants.js';

const SRC_PREFIX = /^src[A-Z]/;

const toDate = (value) => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isTimeoutError = (error) =>
  error?.code === 50 ||
  error?.codeName === 'MaxTimeMSExpired' ||
  /exceeded time limit|maxTimeMS|statement timeout/i.test(String(error?.message ?? ''));

export const isDisabledError = (error) =>
  error instanceof SourceDisabledError || error?.code === 'SOURCE_NOT_ACTIVE';

export function sourceDateField(viewsKey, spec) {
  if (!spec.activityDate) return null;
  const candidate = SRC_PREFIX.test(spec.activityDate)
    ? spec.activityDate[3].toLowerCase() + spec.activityDate.slice(4)
    : spec.activityDate;
  const outputs = new Set(allowedOutputFields(getViewAllowList(viewsKey, spec.view)));
  return outputs.has(candidate) ? candidate : null;
}

export async function countSourceRows({ gate, sourceId, spec, triggeredBy, runId }) {
  try {
    const rows = await gate.read(
      sourceId,
      async (client, { limits }) => {
        const value = await client
          .db()
          .collection(spec.view)
          .estimatedDocumentCount({ maxTimeMS: Math.min(COUNT_MAX_TIME_MS, limits.maxTimeMs) });
        return { value, rows: 0 };
      },
      { entity: spec.entity, action: 'count', triggeredBy, runId, estimatedRows: 1 }
    );
    return { rows: Number.isFinite(rows) ? rows : null, timedOut: false, error: null };
  } catch (error) {
    if (isDisabledError(error)) throw error;
    return { rows: null, timedOut: isTimeoutError(error), error: safeMessage(error, 200) };
  }
}

export async function probeEntityDetails({ gate, sourceId, viewsKey, spec, triggeredBy, runId }) {
  const dateField = sourceDateField(viewsKey, spec);
  const updatedField = spec.cursor.time;
  return gate.read(
    sourceId,
    async (client, { signal, limits }) => {
      const maxTimeMS = Math.min(PROBE_MAX_TIME_MS, limits.maxTimeMs);
      const collection = client.db().collection(spec.view);
      const result = {
        minDate: undefined,
        maxDate: undefined,
        lastUpdatedAt: undefined,
        perMonth: undefined,
        failures: []
      };
      let returned = 0;

      const attempt = async (name, run) => {
        if (signal.aborted) throw signal.reason;
        try {
          return await run();
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (isDisabledError(error)) throw error;
          result.failures.push({
            name,
            timedOut: isTimeoutError(error),
            message: safeMessage(error, 200)
          });
          return undefined;
        }
      };

      const edge = async (field, direction) => {
        const [doc] = await collection
          .find({ [field]: { $type: 'date' } })
          .sort({ [field]: direction })
          .limit(1)
          .project({ [field]: 1, _id: 0 })
          .maxTimeMS(maxTimeMS)
          .toArray();
        if (doc) returned += 1;
        return toDate(doc?.[field]);
      };

      if (dateField) {
        result.minDate = await attempt('minDate', () => edge(dateField, 1));
        result.maxDate = await attempt('maxDate', () => edge(dateField, -1));
      }
      result.lastUpdatedAt = await attempt('lastUpdatedAt', () => edge(updatedField, -1));
      if (dateField) {
        result.perMonth = await attempt('perMonth', async () => {
          const groups = await collection
            .aggregate(
              [
                { $match: { [dateField]: { $type: 'date' } } },
                {
                  $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: `$${dateField}`, timezone: IST } },
                    count: { $sum: 1 }
                  }
                },
                { $sort: { _id: 1 } }
              ],
              { maxTimeMS }
            )
            .toArray();
          returned += groups.length;
          return groups
            .filter((group) => typeof group._id === 'string')
            .map((group) => ({ monthKey: group._id, count: group.count }));
        });
      }
      return { value: result, rows: returned };
    },
    { entity: spec.entity, action: 'read_page', triggeredBy, runId, estimatedRows: 4 }
  );
}
