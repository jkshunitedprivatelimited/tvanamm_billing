/**
 * Weighted-average (moving average) cost, in integer-ish paise carried at high
 * precision. Accounting valuation uses this; FEFO batch picking is a separate
 * concern (Core Invariant 10). All arithmetic is fixed-point via the `Big`-free
 * approach of scaling to micro-paise integers where it matters, but a Number is
 * adequate here because callers round to paise only on read.
 */

export interface AvgState {
  onHandQty: number;
  avgCostPaise: number;
}

/**
 * Fold one inbound receipt into the moving average. Outbound movements do not
 * change the average; they consume at the current average.
 */
export function applyInbound(state: AvgState, inQty: number, inUnitCostPaise: number): AvgState {
  if (inQty <= 0) return state;
  const totalValue = state.onHandQty * state.avgCostPaise + inQty * inUnitCostPaise;
  const newQty = state.onHandQty + inQty;
  return {
    onHandQty: newQty,
    avgCostPaise: newQty > 0 ? totalValue / newQty : 0,
  };
}

/** Reduce on-hand for an outbound movement; average is unchanged. */
export function applyOutbound(state: AvgState, outQty: number): AvgState {
  if (outQty <= 0) return state;
  return { onHandQty: Math.max(0, state.onHandQty - outQty), avgCostPaise: state.avgCostPaise };
}

/** Value of a position at the current moving average, rounded to whole paise. */
export function positionValuePaise(state: AvgState): number {
  return Math.round(state.onHandQty * state.avgCostPaise);
}
