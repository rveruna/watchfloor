import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTime, SEVERITY_LABEL } from './format';

describe('formatTime', () => {
  it('shows hours, minutes and seconds', () => {
    expect(formatTime(new Date(2026, 9, 16, 14, 3, 22).toISOString())).toBe('14:03:22');
  });

  it('takes a number of milliseconds too', () => {
    expect(formatTime(new Date(2026, 9, 16, 9, 5, 1).getTime())).toBe('09:05:01');
  });

  it('shows a dash for something that is not a time, rather than "Invalid Date"', () => {
    expect(formatTime('yesterday-ish')).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('shows the day and month as well', () => {
    expect(formatDateTime(new Date(2026, 9, 16, 14, 3, 22).toISOString())).toMatch(/16 Oct.*14:03:22/);
  });
});

it('has a word for every severity', () => {
  expect(SEVERITY_LABEL).toEqual({ info: 'Info', warning: 'Warning', critical: 'Critical' });
});
