import { describe, expect, it } from 'vitest';
import { entitySpecs } from '@fab5/sources';
import { SourceDisabledError } from '@fab5/source-gate';
import {
  countSourceRows,
  isDisabledError,
  isTimeoutError,
  sourceDateField
} from '../src/inventory/index.js';
import { timeoutError } from './helpers.js';

describe('sourceDateField', () => {
  it('maps each fact entity to an exported view field', () => {
    expect(sourceDateField('crm', entitySpecs.crm.connections)).toBe('createdAt');
    expect(sourceDateField('crm', entitySpecs.crm.service_requests)).toBe('createdAt');
    expect(sourceDateField('crm', entitySpecs.crm.connection_events)).toBe('date');
    expect(sourceDateField('crm', entitySpecs.crm.sales_targets)).toBe('monthStart');
    expect(sourceDateField('bahikhata', entitySpecs.bahikhata.ledger_entries)).toBe('date');
  });

  it('returns null for entities without an activity date', () => {
    expect(sourceDateField('crm', entitySpecs.crm.employees)).toBeNull();
    expect(sourceDateField('bahikhata', entitySpecs.bahikhata.customers)).toBeNull();
  });
});

describe('error classification', () => {
  it('recognises timeouts', () => {
    expect(isTimeoutError(timeoutError())).toBe(true);
    expect(isTimeoutError(new Error('canceling statement due to statement timeout'))).toBe(true);
    expect(isTimeoutError(new Error('connection refused'))).toBe(false);
  });

  it('recognises gate disablement', () => {
    expect(isDisabledError(new SourceDisabledError('crm', 'paused'))).toBe(true);
    expect(isDisabledError(Object.assign(new Error('x'), { code: 'SOURCE_NOT_ACTIVE' }))).toBe(true);
    expect(isDisabledError(new Error('x'))).toBe(false);
  });
});

describe('countSourceRows', () => {
  const spec = entitySpecs.crm.connections;

  it('returns a null count with the timeout flag instead of throwing', async () => {
    const gate = {
      read: async () => {
        throw timeoutError();
      }
    };
    expect(await countSourceRows({ gate, sourceId: 'crm', spec, triggeredBy: 'manual' })).toEqual({
      rows: null,
      timedOut: true,
      error: 'operation exceeded time limit'
    });
  });

  it('records other failures as errors', async () => {
    const gate = {
      read: async () => {
        throw new Error('connect mongodb://user:pw@host/db failed');
      }
    };
    const result = await countSourceRows({ gate, sourceId: 'crm', spec, triggeredBy: 'manual' });
    expect(result.rows).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.error).not.toContain('pw@');
  });

  it('rethrows when the source is no longer active', async () => {
    const gate = {
      read: async () => {
        throw new SourceDisabledError('crm', 'paused');
      }
    };
    await expect(countSourceRows({ gate, sourceId: 'crm', spec, triggeredBy: 'manual' })).rejects.toBeInstanceOf(
      SourceDisabledError
    );
  });
});
