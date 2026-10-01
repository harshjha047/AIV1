import { MBPS_PER_GBPS } from './constants.js';

const PATTERN = /^([\d.]+)\s*(gbps|mbps)?/i;

export const parseBandwidthDetailed = (raw) => {
  if (raw === null || raw === undefined) {
    return { mbps: 0, parsed: false, unit: null, unitAssumed: false, reason: 'missing' };
  }
  const text = String(raw).trim();
  if (text === '')
    return { mbps: 0, parsed: false, unit: null, unitAssumed: false, reason: 'missing' };

  const match = PATTERN.exec(text);
  if (!match) return { mbps: 0, parsed: false, unit: null, unitAssumed: false, reason: 'no_match' };

  const quantity = Number.parseFloat(match[1]);
  if (!Number.isFinite(quantity)) {
    return { mbps: 0, parsed: false, unit: null, unitAssumed: false, reason: 'no_match' };
  }

  const unit = match[2] ? match[2].toLowerCase() : null;
  const mbps = unit === 'gbps' ? quantity * MBPS_PER_GBPS : quantity;
  const trailing = text.slice(match[0].length).trim();
  const unitAssumed = unit === null && /^[a-z]/i.test(trailing);
  return { mbps, parsed: true, unit: unit ?? 'mbps', unitAssumed, reason: null };
};

export const parseBandwidth = (raw) => parseBandwidthDetailed(raw).mbps;

export const isBandwidthUnparsed = (raw) => !parseBandwidthDetailed(raw).parsed;

export const countUnparsedBandwidth = (values) => {
  let count = 0;
  for (const value of values) if (isBandwidthUnparsed(value)) count += 1;
  return count;
};
