import { describe, expect, it } from 'vitest';
import { applyInbound, applyOutbound, positionValuePaise } from './valuation';

describe('weighted-average valuation', () => {
  it('sets the average from the first receipt', () => {
    const s = applyInbound({ onHandQty: 0, avgCostPaise: 0 }, 10, 500);
    expect(s).toEqual({ onHandQty: 10, avgCostPaise: 500 });
  });

  it('blends two receipts by quantity', () => {
    let s = applyInbound({ onHandQty: 0, avgCostPaise: 0 }, 10, 400);
    s = applyInbound(s, 30, 500);
    // (10*400 + 30*500) / 40 = 475
    expect(s.onHandQty).toBe(40);
    expect(s.avgCostPaise).toBeCloseTo(475, 6);
  });

  it('leaves the average unchanged on issue', () => {
    let s = applyInbound({ onHandQty: 0, avgCostPaise: 0 }, 10, 475);
    s = applyOutbound(s, 4);
    expect(s).toEqual({ onHandQty: 6, avgCostPaise: 475 });
  });

  it('never drives on-hand negative in the valuation projection', () => {
    let s = applyInbound({ onHandQty: 0, avgCostPaise: 0 }, 5, 100);
    s = applyOutbound(s, 9);
    expect(s.onHandQty).toBe(0);
  });

  it('values a position at the moving average rounded to paise', () => {
    expect(positionValuePaise({ onHandQty: 3, avgCostPaise: 333.333 })).toBe(1000);
  });
});
