import { describe, expect, it } from 'vitest';
import { mergeHeaders, headersToRecord } from '../../src/utils/headers.js';

describe('headers', () => {
  it('merges case-insensitively with later override', () => {
    const headers = mergeHeaders(undefined, { 'X-App': 'a', 'x-app': 'b' });
    expect(headers.get('x-app')).toBe('b');
  });

  it('converts to record', () => {
    const map = mergeHeaders(undefined, { Authorization: 'Bearer x' });
    expect(headersToRecord(map)).toEqual({ authorization: 'Bearer x' });
  });
});
