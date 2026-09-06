/**
 * First-Expiry-First-Out batch allocation (Core Invariant 10). Recalled and
 * non-active batches are excluded by the caller before this runs.
 */

export interface BatchPosition {
  batchId: string | null;
  /** usable = on_hand - allocated, in the item base unit */
  usable: number;
  /** null expiry sorts last (treated as "never expires") */
  expiryDate: string | null;
  /** tie-breaker: earliest received first */
  createdAt: string;
}

export interface Allocation {
  batchId: string | null;
  quantity: number;
}

export interface FefoResult {
  allocations: Allocation[];
  allocated: number;
  shortfall: number;
}

export function orderFefo(positions: BatchPosition[]): BatchPosition[] {
  return [...positions].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
    } else if (a.expiryDate && !b.expiryDate) {
      return -1;
    } else if (!a.expiryDate && b.expiryDate) {
      return 1;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * Allocate `quantity` (base units) across FEFO-ordered positions. Never
 * over-allocates a position; reports any `shortfall` so the caller can warn and
 * record a negative-stock exception without rejecting the sale.
 */
export function allocateFefo(positions: BatchPosition[], quantity: number): FefoResult {
  const ordered = orderFefo(positions.filter((p) => p.usable > 0));
  const allocations: Allocation[] = [];
  let remaining = quantity;
  for (const pos of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(pos.usable, remaining);
    if (take > 0) {
      allocations.push({ batchId: pos.batchId, quantity: take });
      remaining -= take;
    }
  }
  return {
    allocations,
    allocated: quantity - Math.max(0, remaining),
    shortfall: Math.max(0, remaining),
  };
}
