import { beforeEach, expect, it, vi } from 'vitest';
import { emptyChefDraft, type ActorContext } from '@jksh/contracts';
import type { Pool } from '@jksh/db';
const mocks = vi.hoisted(() => ({ menu: vi.fn(), query: vi.fn() }));
vi.mock('./menu-publish', () => ({ getPublishedMenu: mocks.menu }));
import { getPosRecipeHelp } from './pos-recipe-help';

const actor = {
  role: 'store_employee',
  outletId: 'outlet',
  scope: { organizationId: 'org' },
} as ActorContext;
const pool = { query: mocks.query } as unknown as Pool;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.menu.mockResolvedValue({ items: [{ catalogItemId: 'item' }] });
  mocks.query.mockResolvedValue({ rows: [] });
});
it('requires an outlet employee before reading SOPs', async () => {
  await expect(getPosRecipeHelp(pool, { ...actor, role: 'central_admin' }, 'item')).rejects.toThrow(
    'operator',
  );
  expect(mocks.query).not.toHaveBeenCalled();
});
it('rejects items outside the authenticated outlet menu before querying SOPs', async () => {
  await expect(getPosRecipeHelp(pool, actor, 'other')).rejects.toThrow('published menu');
  expect(mocks.query).not.toHaveBeenCalled();
});
it('scopes lookup to the organization and reports a missing SOP', async () => {
  expect(await getPosRecipeHelp(pool, actor, 'item')).toEqual({ status: 'missing' });
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('c.organization_id = $1'), [
    'org',
    'item',
  ]);
  expect(mocks.query.mock.calls[0]?.[0]).toContain('c.revoked_at is null');
});
it.each([emptyChefDraft(), { ...emptyChefDraft(), status: 'ready' }, { unexpected: true }])(
  'withholds incomplete, draft and malformed content',
  async (draft) => {
    mocks.query.mockResolvedValue({ rows: [{ draft }] });
    expect(await getPosRecipeHelp(pool, actor, 'item')).toEqual({ status: 'not_ready' });
  },
);
it('returns validated ready guidance with original quantities and revision', async () => {
  const draft = {
    ...emptyChefDraft(),
    status: 'ready',
    chefName: 'Chef',
    servingQuantity: '200',
    ingredients: [{ name: 'Milk', quantity: '150', unit: 'ml', note: 'Measured' }],
    method: 'Heat gently.\nServe.',
    packaging: 'Cup',
  };
  const updated = new Date('2026-10-12T00:00:00Z');
  mocks.query.mockResolvedValue({ rows: [{ draft, revision: 3, updated_at: updated }] });
  expect(await getPosRecipeHelp(pool, actor, 'item')).toEqual({
    status: 'ready',
    draft,
    revision: 3,
    updatedAt: updated.toISOString(),
  });
});
