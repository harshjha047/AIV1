import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { idToString, toMongoId } from '../src/engines/mongoIds.js';

describe('mongo id helpers', () => {
  it('converts 24 character hex strings to ObjectId', () => {
    const hex = '64f1a2b3c4d5e6f708192a3b';
    const converted = toMongoId(hex);
    expect(converted).toBeInstanceOf(ObjectId);
    expect(idToString(converted)).toBe(hex);
  });

  it('leaves other values untouched', () => {
    expect(toMongoId('legacy-7')).toBe('legacy-7');
    expect(toMongoId(42)).toBe(42);
    expect(toMongoId(null)).toBeNull();
  });

  it('stringifies ids and passes null through', () => {
    expect(idToString(null)).toBeNull();
    expect(idToString(undefined)).toBeNull();
    expect(idToString(new ObjectId('64f1a2b3c4d5e6f708192a3b'))).toBe('64f1a2b3c4d5e6f708192a3b');
  });
});
