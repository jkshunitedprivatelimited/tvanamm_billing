import { describe, expect, it } from 'vitest';
import { allocateFefo, orderFefo, type BatchPosition } from './fefo';

const p = (over: Partial<BatchPosition>): BatchPosition => ({
  batchId: 'b',
  usable: 10,
  expiryDate: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

describe('orderFefo', () => {
  it('takes the earliest expiry first, null expiry last', () => {
    const ordered = orderFefo([
      p({ batchId: 'no-expiry', expiryDate: null }),
      p({ batchId: 'late', expiryDate: '2026-06-01' }),
      p({ batchId: 'soon', expiryDate: '2026-02-01' }),
    ]);
    expect(ordered.map((x) => x.batchId)).toEqual(['soon', 'late', 'no-expiry']);
  });

  it('breaks ties by received order', () => {
    const ordered = orderFefo([
      p({ batchId: 'second', expiryDate: '2026-02-01', createdAt: '2026-01-10T00:00:00Z' }),
      p({ batchId: 'first', expiryDate: '2026-02-01', createdAt: '2026-01-05T00:00:00Z' }),
    ]);
    expect(ordered.map((x) => x.batchId)).toEqual(['first', 'second']);
  });
});

describe('allocateFefo', () => {
  it('spans multiple batches and reports no shortfall', () => {
    const r = allocateFefo(
      [
        p({ batchId: 'a', usable: 4, expiryDate: '2026-02-01' }),
        p({ batchId: 'b', usable: 10, expiryDate: '2026-03-01' }),
      ],
      9,
    );
    expect(r.allocations).toEqual([
      { batchId: 'a', quantity: 4 },
      { batchId: 'b', quantity: 5 },
    ]);
    expect(r.shortfall).toBe(0);
  });

  it('reports a shortfall instead of over-allocating', () => {
    const r = allocateFefo([p({ batchId: 'a', usable: 3 })], 8);
    expect(r.allocated).toBe(3);
    expect(r.shortfall).toBe(5);
  });

  it('ignores positions with no usable quantity', () => {
    const r = allocateFefo(
      [p({ batchId: 'empty', usable: 0 }), p({ batchId: 'ok', usable: 6 })],
      5,
    );
    expect(r.allocations).toEqual([{ batchId: 'ok', quantity: 5 }]);
  });
});
