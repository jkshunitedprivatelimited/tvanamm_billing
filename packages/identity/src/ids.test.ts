import { describe, expect, it } from 'vitest';
import {
  formatReceiptNumber,
  generateActivationCode,
  generateEmployeeCode,
  isReceiptNumber,
  nextReceiptPrefix,
} from './ids.js';

describe('receipt numbers', () => {
  it('formats YYYYMMDD-Tnn-nnnnnn', () => {
    expect(
      formatReceiptNumber({ year: 2026, month: 9, day: 3 }, 'T01', 1),
    ).toBe('20260903-T01-000001');
  });

  it('validates the shape', () => {
    expect(isReceiptNumber('20260903-T01-000001')).toBe(true);
    expect(isReceiptNumber('20260903-T1-000001')).toBe(false);
    expect(isReceiptNumber('2026-09-03-T01-1')).toBe(false);
  });
});

describe('nextReceiptPrefix', () => {
  it('starts at T01 and fills the first gap', () => {
    expect(nextReceiptPrefix([])).toBe('T01');
    expect(nextReceiptPrefix(['T01', 'T02'])).toBe('T03');
    expect(nextReceiptPrefix(['T01', 'T03'])).toBe('T02');
  });

  it('throws past 99 terminals', () => {
    const all = Array.from({ length: 99 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
    expect(() => nextReceiptPrefix(all)).toThrow();
  });
});

describe('generated codes', () => {
  it('match their expected patterns', () => {
    expect(generateEmployeeCode()).toMatch(/^EMP-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(generateActivationCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });
});
