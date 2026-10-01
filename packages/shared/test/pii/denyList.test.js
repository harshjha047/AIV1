import { describe, expect, it } from 'vitest';
import {
  ALLOWED_EMAIL_TYPES,
  DENY_KEYS,
  isDeniedEmailType,
  isDeniedKey,
  matchDeniedPath
} from '../../src/pii/denyList.js';

describe('deny-list keys', () => {
  it.each(DENY_KEYS)('denies %s', (key) => {
    expect(isDeniedKey(key)).toBe(true);
  });

  it.each([
    'passwordHash',
    'resetPasswordToken',
    'accessToken',
    'clientSecret',
    'OTPCode',
    'aadhaarNumber',
    'aadharNo',
    'adhar_number',
    'panNumber',
    'pan',
    'userPan',
    'token_hash',
    'ip_address',
    'userAgent'
  ])('denies variant %s', (key) => {
    expect(isDeniedKey(key)).toBe(true);
  });

  it.each([
    'name',
    'email',
    'company',
    'companyName',
    'expand',
    'panel',
    'secretary',
    'mrcPaise',
    'bandwidthMbps',
    'remarksSnippet',
    'invoiceNumber',
    'opportunityId',
    'completionTokens',
    'telcoSrNumber'
  ])('allows %s', (key) => {
    expect(isDeniedKey(key)).toBe(false);
  });

  it('finds denied segments in nested paths', () => {
    expect(matchDeniedPath('customer.contact.panNumber')).toEqual({
      segment: 'panNumber',
      rule: 'key_exact'
    });
    expect(matchDeniedPath('history[0].note')).toBeNull();
  });
});

describe('email types', () => {
  it.each(ALLOWED_EMAIL_TYPES)('allows %s', (type) => {
    expect(isDeniedEmailType(type)).toBe(false);
  });

  it.each(['STAFF_WELCOME', 'CUSTOMER_WELCOME', 'PASSWORD_RESET_OTP', 'UNKNOWN', undefined])(
    'denies %s',
    (type) => {
      expect(isDeniedEmailType(type)).toBe(true);
    }
  );
});
