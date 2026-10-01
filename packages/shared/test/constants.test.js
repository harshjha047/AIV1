import { describe, expect, it } from 'vitest';
import {
  AI_ROLES,
  DATA_QUALITY,
  EMBEDDING_DIM,
  KPI_PROFILES,
  LOGICAL_SOURCES,
  MBPS_PER_GBPS,
  MODES,
  SOURCE_IDS,
  SYSTEM_FIELDS,
  TIME_ZONE,
} from '../src/index.js';

describe('constants', () => {
  it('match the schema conventions', () => {
    expect(TIME_ZONE).toBe('Asia/Kolkata');
    expect(MODES).toEqual(['practice', 'production']);
    expect(LOGICAL_SOURCES).toEqual(['crm', 'bahikhata', 'invoicing', 'samadhan']);
    expect(SOURCE_IDS).toEqual([...LOGICAL_SOURCES, 'samadhan_synthetic', 'invoicing_synthetic']);
    expect(AI_ROLES).toEqual(['employee', 'manager', 'admin', 'owner']);
    expect(KPI_PROFILES).toEqual(['sales', 'collections', 'support']);
    expect(SYSTEM_FIELDS).toEqual(['_src', '_hash', '_runId', '_syncedAt', '_deleted']);
    expect(EMBEDDING_DIM).toBe(768);
    expect(MBPS_PER_GBPS).toBe(1000);
  });

  it('list every data-quality flag named in TRD 6.1', () => {
    for (const flag of [
      'NO_TARGET',
      'BANDWIDTH_UNPARSED',
      'SOURCE_STALE',
      'UNMAPPED_CUSTOMER',
      'SYNTHETIC_SOURCE',
    ]) {
      expect(DATA_QUALITY[flag]).toBe(flag);
    }
  });

  it('are frozen', () => {
    expect(Object.isFrozen(SOURCE_IDS)).toBe(true);
    expect(Object.isFrozen(DATA_QUALITY)).toBe(true);
  });
});
