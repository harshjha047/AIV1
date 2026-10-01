import { describe, expect, it } from 'vitest';
import { sourceVisibility, visibilityFilter, visibleSources } from '../src/visibility.js';
import { sourceDoc } from './helpers.js';

describe('visibility', () => {
  it.each([
    ['active', 'hide', 'live'],
    ['paused', 'hide', 'stale'],
    ['disabled', 'keep', 'stale'],
    ['disabled', 'hide', 'hidden'],
    ['disabled', 'purge', 'hidden'],
    ['not_configured', 'hide', 'hidden']
  ])('%s with onDisable=%s is %s', (state, onDisable, expected) => {
    expect(sourceVisibility(sourceDoc({ state, onDisable }))).toBe(expected);
  });

  it('hides synthetic data while the real source is active', () => {
    const real = sourceDoc({ _id: 'invoicing', logicalSource: 'invoicing', state: 'active' });
    const synthetic = sourceDoc({
      _id: 'invoicing_synthetic',
      logicalSource: 'invoicing',
      kind: 'synthetic',
      state: 'paused'
    });
    expect(visibleSources([real, synthetic]).ids).toEqual(['invoicing']);
    expect(visibleSources([{ ...real, state: 'not_configured' }, synthetic]).ids).toEqual([
      'invoicing_synthetic'
    ]);
  });

  it('builds a query filter', () => {
    const filter = visibilityFilter([
      sourceDoc({ _id: 'crm', state: 'active' }),
      sourceDoc({ _id: 'bahikhata', state: 'disabled', onDisable: 'hide' })
    ]);
    expect(filter).toEqual({ _src: { $in: ['crm'] } });
  });
});
