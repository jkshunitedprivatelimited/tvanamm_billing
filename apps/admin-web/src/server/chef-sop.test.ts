import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./pool', () => ({ db: () => ({ query: mocks.query, connect: mocks.connect }) }));
import { readChefCollection, saveChefEntry, hashChefToken } from './chef-sop';
import { emptyChefDraft } from './chef-sop-schema';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});
it('hashes the capability rather than storing the share token', () => {
  expect(hashChefToken('example')).toHaveLength(64);
  expect(hashChefToken('example')).not.toContain('example');
});
it('rejects an expired or revoked capability', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(readChefCollection({ token: 'invalid' })).rejects.toThrow('expired');
  expect(mocks.query.mock.calls[0]?.[0]).toContain('revoked_at is null and expires_at>now()');
});
it('rejects saves for a closed collection and rolls back', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  await expect(
    saveChefEntry('invalid', '00000000-0000-4000-8000-000000000001', 0, emptyChefDraft()),
  ).rejects.toThrow('closed');
  expect(mocks.query).toHaveBeenCalledWith('rollback');
  expect(mocks.release).toHaveBeenCalled();
});
it('rejects a menu item outside the capability scope', async () => {
  mocks.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'collection', menu: [], submitted_at: null }] })
    .mockResolvedValue({ rows: [] });
  await expect(saveChefEntry('token', 'outside', 0, emptyChefDraft())).rejects.toThrow(
    'not in this menu',
  );
});
