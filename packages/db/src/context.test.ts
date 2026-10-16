import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { applyContext } from './context';
it('sets and clears every actor context field in one query after selecting the role', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  await applyContext({ query } as unknown as PoolClient, {
    request: 'operator',
    outletId: 'outlet',
  });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls[0]?.[0]).toBe('set local role identity_api');
  expect(query.mock.calls[1]?.[1]).toEqual([
    'app.request',
    'operator',
    'app.account_id',
    '',
    'app.role',
    '',
    'app.organization_id',
    '',
    'app.franchise_id',
    '',
    'app.outlet_id',
    'outlet',
    'app.operator_employee_id',
    '',
  ]);
  expect(query.mock.calls[1]?.[0]).toContain('set_config($13, $14, true)');
});
