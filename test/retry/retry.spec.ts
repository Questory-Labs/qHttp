import { describe, expect, it } from 'vitest';
import { isRetryableDefault } from '../../src/retry/retry.js';
import { QHttpError } from '../../src/errors/qhttp-error.js';

describe('retry policy', () => {
  it('retries GET on 503 by default', () => {
    const err = new QHttpError('fail', { httpStatus: 503 });
    expect(isRetryableDefault(err, 'GET')).toBe(true);
  });

  it('does not retry POST by default', () => {
    const err = new QHttpError('fail', { httpStatus: 503 });
    expect(isRetryableDefault(err, 'POST')).toBe(false);
  });
});
