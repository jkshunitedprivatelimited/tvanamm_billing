import { describe, expect, it } from 'vitest';
import {
  STOCK_CAPABILITIES,
  STOCK_ACTOR_ROLES,
  STOCK_ROLE_CAPABILITIES,
  stockRoleGrants,
} from '@jksh/contracts';

describe('STOCK_ROLE_CAPABILITIES', () => {
  it('only references declared capabilities', () => {
    for (const role of STOCK_ACTOR_ROLES) {
      for (const cap of STOCK_ROLE_CAPABILITIES[role]) {
        expect(STOCK_CAPABILITIES).toContain(cap);
      }
    }
  });

  it('grants Central Admin every capability', () => {
    expect([...STOCK_ROLE_CAPABILITIES.central_admin].sort()).toEqual(
      [...STOCK_CAPABILITIES].sort(),
    );
  });

  it('never lets a non-central role approve exceptional adjustments except a warehouse manager', () => {
    const approvers = STOCK_ACTOR_ROLES.filter((r) =>
      stockRoleGrants(r, 'stock.adjustment.approve'),
    );
    expect(approvers.sort()).toEqual(['central_admin', 'warehouse_manager']);
  });

  it('keeps warehouse staff out of supplier payments and adjustments', () => {
    expect(stockRoleGrants('warehouse_staff', 'stock.supplier_payment.record')).toBe(false);
    expect(stockRoleGrants('warehouse_staff', 'stock.adjustment.approve')).toBe(false);
  });

  it('lets the accountant record supplier payments but not receive stock', () => {
    expect(stockRoleGrants('accountant', 'stock.supplier_payment.record')).toBe(true);
    expect(stockRoleGrants('accountant', 'stock.receiving.operate')).toBe(false);
  });
});
