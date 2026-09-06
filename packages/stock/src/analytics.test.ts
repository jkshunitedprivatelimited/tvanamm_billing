import { describe, expect, it } from 'vitest';
import { suggestReorderQty, type SuggestionInputs } from './analytics';

const base: SuggestionInputs = {
  trailingDailyConsumptionBase: 10,
  leadTimeDays: 3,
  safetyDays: 2,
  usableStockBase: 0,
  confirmedInboundBase: 0,
  backorderBase: 0,
  orderPackBase: 1,
};

describe('suggestReorderQty', () => {
  it('forecasts demand across lead time plus safety days', () => {
    // 10/day * (3 + 2) = 50
    expect(suggestReorderQty(base)).toBe(50);
  });

  it('subtracts usable stock and confirmed inbound, adds backorder', () => {
    expect(
      suggestReorderQty({
        ...base,
        usableStockBase: 20,
        confirmedInboundBase: 10,
        backorderBase: 5,
      }),
    ).toBe(25);
  });

  it('never suggests a negative quantity', () => {
    expect(suggestReorderQty({ ...base, usableStockBase: 999 })).toBe(0);
  });

  it('rounds up to the order pack', () => {
    expect(suggestReorderQty({ ...base, orderPackBase: 12 })).toBe(60); // ceil(50/12)*12
  });

  it('never auto-orders - it only returns a number', () => {
    expect(typeof suggestReorderQty(base)).toBe('number');
  });
});
