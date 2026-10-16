import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF } from './backoff';

describe('backoffDelay', () => {
  it('waits up to the base after the first failure, and up to double after the second', () => {
    expect(backoffDelay(1, () => 0.999)).toBe(499);
    expect(backoffDelay(2, () => 0.999)).toBe(999);
    expect(backoffDelay(3, () => 0.999)).toBe(1998);
  });

  it('stops growing at the ceiling', () => {
    expect(backoffDelay(30, () => 0.999999)).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
    expect(backoffDelay(30, () => 0.999999)).toBeGreaterThan(DEFAULT_BACKOFF.maxMs - 100);
  });

  it('is never zero, so a retry loop cannot spin', () => {
    expect(backoffDelay(1, () => 0)).toBe(1);
  });

  it('is always within bounds, for any number of failures and any dice roll', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 0, max: 0.9999999, noNaN: true }),
        (attempt, roll) => {
          const ms = backoffDelay(attempt, () => roll);
          expect(ms).toBeGreaterThanOrEqual(1);
          expect(ms).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
        },
      ),
    );
  });

  it('treats attempt 0 or less like the first', () => {
    expect(backoffDelay(0, () => 0.999)).toBe(499);
    expect(backoffDelay(-3, () => 0.999)).toBe(499);
  });
});
