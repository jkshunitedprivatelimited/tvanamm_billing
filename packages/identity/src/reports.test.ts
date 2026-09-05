import { describe, expect, it } from 'vitest';
import { resolveDateRange } from './reports';

const TZ = 'Asia/Kolkata';
// 2026-09-05 10:00 IST
const NOW = new Date('2026-09-05T04:30:00.000Z');

describe('resolveDateRange', () => {
  it('resolves today and yesterday in the outlet timezone', () => {
    expect(resolveDateRange({ kind: 'today' }, TZ, NOW)).toEqual({
      from: '2026-09-05',
      to: '2026-09-05',
    });
    expect(resolveDateRange({ kind: 'yesterday' }, TZ, NOW)).toEqual({
      from: '2026-09-04',
      to: '2026-09-04',
    });
  });

  it('resolves last7 and last30 as inclusive windows ending today', () => {
    expect(resolveDateRange({ kind: 'last7' }, TZ, NOW)).toEqual({
      from: '2026-08-30',
      to: '2026-09-05',
    });
    expect(resolveDateRange({ kind: 'last30' }, TZ, NOW)).toEqual({
      from: '2026-08-07',
      to: '2026-09-05',
    });
  });

  it('accepts a valid custom range and rejects an inverted or incomplete one', () => {
    expect(
      resolveDateRange({ kind: 'custom', from: '2026-01-01', to: '2026-01-31' }, TZ, NOW),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(() => resolveDateRange({ kind: 'custom', from: '2026-02-01' }, TZ, NOW)).toThrow(
      /needs both/,
    );
    expect(() =>
      resolveDateRange({ kind: 'custom', from: '2026-02-10', to: '2026-02-01' }, TZ, NOW),
    ).toThrow(/must not be after/);
  });
});
