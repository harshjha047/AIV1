import { describe, expect, it } from 'vitest';
import {
  countUnparsedBandwidth,
  isBandwidthUnparsed,
  parseBandwidth,
  parseBandwidthDetailed,
} from '../src/index.js';

describe('parseBandwidth mirrors the CRM parser', () => {
  it('parses Mbps in any case and spacing', () => {
    expect(parseBandwidth('500Mbps')).toBe(500);
    expect(parseBandwidth('500 mbps')).toBe(500);
    expect(parseBandwidth('500   MBPS')).toBe(500);
    expect(parseBandwidth('  200 Mbps ')).toBe(200);
  });

  it('converts Gbps at 1000 Mbps each', () => {
    expect(parseBandwidth('1Gbps')).toBe(1000);
    expect(parseBandwidth('1.5 Gbps')).toBe(1500);
    expect(parseBandwidth('10 GBPS')).toBe(10000);
    expect(parseBandwidth('0.1gbps')).toBe(100);
  });

  it('treats a bare number as Mbps', () => {
    expect(parseBandwidth('100')).toBe(100);
    expect(parseBandwidth(300)).toBe(300);
    expect(parseBandwidth('2.5')).toBe(2.5);
  });

  it('keeps trailing text after the quantity, like the CRM prefix match', () => {
    expect(parseBandwidth('100 Mbps ILL')).toBe(100);
    expect(parseBandwidth('2Gbps (primary)')).toBe(2000);
    expect(parseBandwidth('1,000 Mbps')).toBe(1);
    expect(parseBandwidth('1.2.3 Mbps')).toBe(1.2);
  });

  it('returns 0 for unparsable values', () => {
    for (const raw of ['', '   ', null, undefined, 'abc', 'Mbps 500', '-5 Mbps', '.', '..']) {
      expect(parseBandwidth(raw)).toBe(0);
    }
  });
});

describe('parseBandwidthDetailed', () => {
  it('reports unit, parse state and reason', () => {
    expect(parseBandwidthDetailed('1.5 Gbps')).toEqual({
      mbps: 1500,
      parsed: true,
      unit: 'gbps',
      unitAssumed: false,
      reason: null,
    });
    expect(parseBandwidthDetailed('500')).toMatchObject({
      mbps: 500,
      parsed: true,
      unit: 'mbps',
      unitAssumed: false,
    });
  });

  it('distinguishes missing from unmatched', () => {
    expect(parseBandwidthDetailed(null)).toMatchObject({
      mbps: 0,
      parsed: false,
      reason: 'missing',
    });
    expect(parseBandwidthDetailed('  ')).toMatchObject({
      mbps: 0,
      parsed: false,
      reason: 'missing',
    });
    expect(parseBandwidthDetailed('abc')).toMatchObject({
      mbps: 0,
      parsed: false,
      reason: 'no_match',
    });
    expect(parseBandwidthDetailed('.')).toMatchObject({
      mbps: 0,
      parsed: false,
      reason: 'no_match',
    });
  });

  it('flags a quantity followed by an unrecognised unit as assumed Mbps', () => {
    expect(parseBandwidthDetailed('1G')).toMatchObject({
      mbps: 1,
      parsed: true,
      unitAssumed: true,
    });
    expect(parseBandwidthDetailed('100 mb')).toMatchObject({ mbps: 100, unitAssumed: true });
    expect(parseBandwidthDetailed('100 ILL')).toMatchObject({ mbps: 100, unitAssumed: true });
    expect(parseBandwidthDetailed('100 Mbps ILL')).toMatchObject({ unitAssumed: false });
  });
});

describe('unparsed counting', () => {
  it('flags values that produced no bandwidth', () => {
    expect(isBandwidthUnparsed('100')).toBe(false);
    expect(isBandwidthUnparsed('')).toBe(true);
    expect(isBandwidthUnparsed('n/a')).toBe(true);
    expect(isBandwidthUnparsed(null)).toBe(true);
  });

  it('counts unparsed entries for the data-quality flag', () => {
    expect(countUnparsedBandwidth(['100', '', 'x', null, '2Gbps', '1G'])).toBe(3);
    expect(countUnparsedBandwidth([])).toBe(0);
  });
});
