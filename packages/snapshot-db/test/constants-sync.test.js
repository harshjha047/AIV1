import { describe, expect, it } from 'vitest';
import {
  AI_ROLES,
  KPI_PROFILES,
  LOGICAL_SOURCES,
  MODES,
  ON_DISABLE_POLICIES,
  SOURCE_STATES,
} from '@fab5/shared/constants';
import { COLLECTIONS, VALIDATORS } from '../src/index.js';

describe('shared constants stay in step with the snapshot validators', () => {
  const dataSources = VALIDATORS.data_sources.properties;

  it('covers data_sources enumerations', () => {
    expect(COLLECTIONS).toContain('data_sources');
    expect(dataSources.logicalSource.enum).toEqual(LOGICAL_SOURCES);
    expect(dataSources.mode.enum).toEqual(MODES);
    expect(dataSources.state.enum).toEqual(SOURCE_STATES);
    expect(dataSources.onDisable.enum).toEqual(ON_DISABLE_POLICIES);
  });

  it('covers employee roles and KPI profiles', () => {
    expect(VALIDATORS.employees.properties.aiRole.enum).toEqual(AI_ROLES);
    expect(VALIDATORS.employee_kpi_profiles.properties.profile.enum).toEqual(KPI_PROFILES);
  });
});
