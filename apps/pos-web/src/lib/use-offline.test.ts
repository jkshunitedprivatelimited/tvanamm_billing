import { beforeEach, expect, it, vi } from 'vitest';
import type { PosMenuSnapshot } from '@jksh/contracts';
const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('./offline-store', () => ({ readOfflineKit: mocks.read, saveOfflineKit: mocks.save }));
import { primeOnce } from './use-offline';
const menu = { outletId: 'outlet' } as PosMenuSnapshot;
beforeEach(() => {
  vi.resetAllMocks();
});
it('replaces an expired block even when many unused receipt numbers remain', async () => {
  mocks.read.mockResolvedValue({
    menu,
    receiptNumbers: Array(40).fill('old'),
    blockExpiresAt: '2020-01-01',
    businessDate: '2020-01-01',
  });
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'auth', expiresAt: '2099-01-01' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ businessDate: '2026-10-16', numbers: ['new'], expiresAt: '2099-01-01' }),
    });
  vi.stubGlobal('fetch', fetch);
  await primeOnce(menu, 'Outlet', 'employee', 'Name');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ receiptNumbers: ['new'], businessDate: '2026-10-16' }),
  );
  vi.unstubAllGlobals();
});
it('does not copy another outlet’s reserved numbers into a new session', async () => {
  mocks.read.mockResolvedValue({
    menu: { outletId: 'other' },
    receiptNumbers: Array(40).fill('other'),
    blockExpiresAt: '2099-01-01',
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'auth', expiresAt: '2099-01-01' }),
      })
      .mockResolvedValueOnce({ ok: false }),
  );
  await primeOnce(menu, 'Outlet', 'employee', 'Name');
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({ receiptNumbers: [], blockExpiresAt: '' }),
  );
  vi.unstubAllGlobals();
});
