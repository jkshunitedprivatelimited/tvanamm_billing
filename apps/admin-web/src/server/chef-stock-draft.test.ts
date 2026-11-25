import { beforeEach, expect, it, vi } from 'vitest';
import type { ActorContext } from '@jksh/contracts';
import { emptyChefDraft } from './chef-sop-schema';
const mocks = vi.hoisted(() => ({ read: vi.fn(), query: vi.fn(), audit: vi.fn(), actor: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./chef-sop', () => ({ readChefCollection: mocks.read }));
vi.mock('./stock', () => ({ stockActorFor: mocks.actor, stockDb: () => ({}) }));
vi.mock('@jksh/db', () => ({
  withStockActorContext: async (_p: unknown, _a: unknown, run: (c: unknown) => unknown) =>
    run({ query: mocks.query }),
}));
vi.mock('@jksh/stock', () => ({ stockContextForActor: () => ({}), recordStockAudit: mocks.audit }));
import { prepareChefStockDraft } from './chef-stock-draft';
const input = {
  collectionId: '00000000-0000-4000-8000-000000000001',
  itemId: '00000000-0000-4000-8000-000000000002',
  revision: 3,
};
const actor = {
  role: 'central_admin',
  accountId: '00000000-0000-4000-8000-000000000003',
} as ActorContext;
const draft = {
  ...emptyChefDraft(),
  chefName: 'Chef',
  servingQuantity: '110',
  method: 'Mix and serve',
  packaging: 'Cup',
  ingredients: [{ name: 'Milk', quantity: '100', unit: 'ml' as const, note: '' }],
  status: 'ready' as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({
    menu: [{ id: input.itemId, name: 'Milk tea' }],
    entries: [{ itemId: input.itemId, revision: 3, draft }],
  });
  mocks.actor.mockResolvedValue({
    organizationId: '00000000-0000-4000-8000-000000000004',
    request: 'admin',
  });
  mocks.query.mockResolvedValue({ rowCount: 1 });
});
it('preserves a revision snapshot and makes retries reuse the same draft without overwriting', async () => {
  const first = await prepareChefStockDraft(actor, input);
  mocks.query.mockResolvedValue({ rowCount: 0 });
  const retry = await prepareChefStockDraft(actor, input);
  expect(retry).toEqual({ recipeId: first.recipeId, created: false });
  expect(mocks.query.mock.calls[0]?.[0]).toContain('on conflict (id) do nothing');
  expect(JSON.parse(mocks.query.mock.calls[0]?.[1][4])).toMatchObject({
    source: 'chef_workbook',
    revision: 3,
    draft,
  });
  expect(mocks.audit).toHaveBeenCalledTimes(1);
});
it('rejects an unreviewed new revision before writing Stock', async () => {
  await expect(prepareChefStockDraft(actor, { ...input, revision: 2 })).rejects.toThrow('Reload');
  expect(mocks.query).not.toHaveBeenCalled();
});
it('rejects incomplete SOPs even if the caller asks to prepare a draft', async () => {
  mocks.read.mockResolvedValue({
    menu: [{ id: input.itemId }],
    entries: [{ itemId: input.itemId, revision: 3, draft: emptyChefDraft() }],
  });
  await expect(prepareChefStockDraft(actor, input)).rejects.toThrow('Complete and review');
  expect(mocks.query).not.toHaveBeenCalled();
});
it('honors the source collection organization check before Stock access', async () => {
  mocks.read.mockRejectedValue(new Error('Central workspace required'));
  await expect(prepareChefStockDraft(actor, input)).rejects.toThrow('Central workspace');
  expect(mocks.actor).not.toHaveBeenCalled();
  expect(mocks.query).not.toHaveBeenCalled();
});
